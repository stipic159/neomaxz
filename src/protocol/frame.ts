import { decode, encode, ExtensionCodec, ExtData } from "@msgpack/msgpack";
import { decompress as zstdDecompress } from "fzstd";
import * as lz4 from "lz4js";
import { compressBlock, decompressBlock } from "./lz4.js";
import { Command, PROTOCOL_VERSION } from "./opcodes.js";

export const HEADER_SIZE = 10;
export const SEQ_MODULO = 0x1_0000;
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024; // 16 MiB max payload
export const MAX_DECOMPRESSED_SIZE = 32 * 1024 * 1024; // 32 MiB max decompressed
export const COMPRESS_THRESHOLD = 32;

const ZSTD_FLAG = 0xff;
const MAX_LZ4_FACTOR = 0x7f;
const WRAPPED_EXT_TYPE = 1;

const SHARED_DECOMPRESS_BUF_SIZE = 512 * 1024;
const sharedDecompressBuf = Buffer.alloc(SHARED_DECOMPRESS_BUF_SIZE);

export class FrameError extends Error {
  constructor(message: string) {
    super(`Frame error: ${message}`);
    this.name = "FrameError";
  }
}

export interface FrameHeader {
  ver: number;
  cmd: Command | number;
  seq: number;
  opcode: number;
  flags: number;
  length: number;
}

export interface InboundFrame extends FrameHeader {
  payload: Record<string, any> | null;
}

export interface OutboundFrame {
  seq: number;
  opcode: number;
  cmd?: Command | number;
  payload?: Record<string, any> | null;
  /** Explicitly request LZ4 compression for body. Defaults to false (MAX servers reject compressed client frames) */
  compress?: boolean;
}

// Extension codec to handle MAX's 64-bit wrapped ID extension
const extensionCodec = new ExtensionCodec();
extensionCodec.register({
  type: WRAPPED_EXT_TYPE,
  encode: () => null,
  decode: (data: Uint8Array) => decodePayloadBytes(data),
});

/**
 * Normalizes values: converts BigInt to number if within safe integer range,
 * otherwise preserves BigInt or string representation.
 */
function narrowValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(narrowValue);
  }
  if (isPlainRecord(value)) {
    for (const key of Object.keys(value)) {
      value[key] = narrowValue(value[key]);
    }
  }
  return value;
}

function wrapBigints(value: unknown): unknown {
  if (typeof value === "bigint") {
    return new ExtData(WRAPPED_EXT_TYPE, encode(value, { useBigInt64: true }));
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && (value > 0xffff_ffff || value < -0x8000_0000)) {
    return BigInt(value);
  }
  if (Array.isArray(value)) {
    return value.map(wrapBigints);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wrapBigints(v)]));
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function asMapKey(key: unknown): string {
  if (typeof key === "string") return key;
  if (typeof key === "number" || typeof key === "bigint") return String(key);
  throw new FrameError(`Unsupported map key type: ${typeof key}`);
}

export function encodePayload(payload: Record<string, any>): Uint8Array {
  return encode(payload, {
    useBigInt64: true,
    ignoreUndefined: true,
  });
}

export function decodePayloadBytes(bytes: Uint8Array): unknown {
  return narrowValue(
    decode(bytes, {
      extensionCodec,
      useBigInt64: true,
      mapKeyConverter: asMapKey,
    })
  );
}

/**
 * Decodes 10-byte frame header from Uint8Array
 */
export function decodeHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.length < HEADER_SIZE) {
    throw new FrameError(`Buffer too short for header: ${bytes.length} bytes (expected at least ${HEADER_SIZE})`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ver = view.getUint8(0);
  const cmd = view.getUint8(1);
  const seq = view.getUint16(2);
  const opcode = view.getUint16(4);
  const packed = view.getUint32(6);

  const flags = packed >>> 24;
  const length = packed & 0x00ffffff;

  return { ver, cmd, seq, opcode, flags, length };
}

/**
 * Encodes an OutboundFrame into binary Uint8Array ready to send over WebSocket or TLS socket.
 * Outgoing frames sent to MAX are never compressed unless explicitly requested (flag byte stays 0),
 * as api2.oneme.ru resets the TCP connection on compressed client frames.
 */
export function encodeFrame(frame: OutboundFrame): Uint8Array {
  let body: Uint8Array;
  if (frame.payload && Object.keys(frame.payload).length > 0) {
    body = encodePayload(frame.payload);
  } else {
    body = new Uint8Array(0);
  }

  let flags = 0;
  if (frame.compress && body.length >= COMPRESS_THRESHOLD) {
    const compressed = compressBlock(body);
    const factor = Math.ceil(body.length / compressed.length);
    if (factor <= MAX_LZ4_FACTOR) {
      body = compressed;
      flags = factor;
    }
  }

  const result = new Uint8Array(HEADER_SIZE + body.length);
  const view = new DataView(result.buffer);

  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, frame.cmd ?? Command.REQUEST);
  view.setUint16(2, frame.seq % SEQ_MODULO);
  view.setUint16(4, frame.opcode);
  view.setUint32(6, ((flags << 24) | body.length) >>> 0);

  result.set(body, HEADER_SIZE);
  return result;
}

/**
 * Decodes a complete binary frame (header + payload) into an InboundFrame object.
 */
export function decodeFrame(bytes: Uint8Array): InboundFrame {
  const header = decodeHeader(bytes);
  const expectedTotal = HEADER_SIZE + header.length;

  if (bytes.length < expectedTotal) {
    throw new FrameError(`Frame claims ${header.length} body bytes, but received only ${bytes.length - HEADER_SIZE}`);
  }

  let body = bytes.subarray(HEADER_SIZE, expectedTotal);

  if (header.flags === ZSTD_FLAG) {
    body = zstdDecompress(body);
  } else if (header.flags > 0) {
    if (header.flags > MAX_LZ4_FACTOR) {
      throw new FrameError(`Unknown compression flag: 0x${header.flags.toString(16)}`);
    }

    // Dynamic sizing based on header compression factor and payload length
    const estimated = Math.min(
      Math.max((header.flags + 1) * header.length * 2, 4096),
      MAX_DECOMPRESSED_SIZE
    );

    let decompressed: Uint8Array | null = null;
    const inputBuf = Buffer.isBuffer(body)
      ? body
      : Buffer.from(body.buffer, body.byteOffset, body.byteLength);

    try {
      const outBuf =
        estimated <= SHARED_DECOMPRESS_BUF_SIZE
          ? sharedDecompressBuf
          : Buffer.alloc(estimated);

      const written = lz4.decompressBlock(inputBuf, outBuf, 0, inputBuf.length, 0);
      if (written > 0) {
        // Copy decompressed slice so the shared buffer pool can be safely reused
        decompressed = Uint8Array.prototype.slice.call(outBuf, 0, written);
      }
    } catch {
      decompressed = null;
    }

    if (!decompressed) {
      decompressed = decompressBlock(body, estimated, MAX_DECOMPRESSED_SIZE);
    }
    body = decompressed;
  }

  if (body.length === 0) {
    return { ...header, payload: null };
  }

  const rawDecoded = decodePayloadBytes(body);
  const payload = isPlainRecord(rawDecoded) ? rawDecoded : { value: rawDecoded };

  return { ...header, payload };
}

/**
 * Accumulator stream buffer for handling incoming TCP / TLS chunk fragmentation.
 */
export class StreamFrameBuffer {
  private buffer: Buffer = Buffer.alloc(0);

  public append(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  public nextFrame(): InboundFrame | null {
    if (this.buffer.length < HEADER_SIZE) {
      return null;
    }

    const headerBytes = new Uint8Array(this.buffer.subarray(0, HEADER_SIZE));
    const header = decodeHeader(headerBytes);
    const totalLength = HEADER_SIZE + header.length;

    if (this.buffer.length < totalLength) {
      return null; // Awaiting more data chunks
    }

    const frameBytes = new Uint8Array(this.buffer.subarray(0, totalLength));
    this.buffer = Buffer.from(this.buffer.subarray(totalLength));

    return decodeFrame(frameBytes);
  }

  public clear(): void {
    this.buffer = Buffer.alloc(0);
  }
}
