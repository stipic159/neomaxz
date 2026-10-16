/**
 * Pure TypeScript LZ4 block format compression & decompression.
 * Operates without native bindings and works across all platforms (Node.js, Bun, browsers).
 */

const MIN_MATCH = 4;
const LAST_LITERALS = 5;
const MF_LIMIT = 12;
const MAX_OFFSET = 0xffff;
const HASH_BITS = 12;

export class Lz4Error extends Error {
  constructor(message: string) {
    super(`LZ4 error: ${message}`);
    this.name = "Lz4Error";
  }
}

class GrowableBuffer {
  buffer: Uint8Array;
  length = 0;

  constructor(initialCapacity = 256) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let nextCap = this.buffer.length * 2;
    while (nextCap < this.length + extra) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buffer);
    this.buffer = next;
  }

  push(byte: number): void {
    this.ensure(1);
    this.buffer[this.length++] = byte;
  }

  set(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  finish(): Uint8Array {
    return this.buffer.subarray(0, this.length);
  }
}

export function decompressBlock(
  src: Uint8Array,
  initialOrMaxSize: number = 64 * 1024,
  maxAllowedSize = 32 * 1024 * 1024
): Uint8Array {
  let capacity = Math.min(Math.max(initialOrMaxSize, 1024), maxAllowedSize);
  let dst = new Uint8Array(capacity);
  let srcPos = 0;
  let dstPos = 0;

  const ensureCapacity = (extra: number) => {
    if (dstPos + extra <= dst.length) return;
    let nextCap = dst.length * 2;
    while (nextCap < dstPos + extra) nextCap *= 2;
    if (nextCap > maxAllowedSize) {
      if (dstPos + extra > maxAllowedSize) {
        throw new Lz4Error(`Decompressed size exceeds maximum allowed limit (${maxAllowedSize} bytes)`);
      }
      nextCap = maxAllowedSize;
    }
    const next = new Uint8Array(nextCap);
    next.set(dst.subarray(0, dstPos));
    dst = next;
  };

  while (srcPos < src.length) {
    const token = src[srcPos++];
    let literalLen = token >> 4;

    if (literalLen === 15) {
      let extra: number;
      do {
        if (srcPos >= src.length) throw new Lz4Error("unexpected end of block in literal length");
        extra = src[srcPos++];
        literalLen += extra;
      } while (extra === 255);
    }

    if (srcPos + literalLen > src.length) throw new Lz4Error("literal length exceeds input bounds");
    ensureCapacity(literalLen);

    dst.set(src.subarray(srcPos, srcPos + literalLen), dstPos);
    srcPos += literalLen;
    dstPos += literalLen;

    if (srcPos >= src.length) break;

    if (srcPos + 2 > src.length) throw new Lz4Error("truncated offset");
    const offset = src[srcPos] | (src[srcPos + 1] << 8);
    srcPos += 2;

    if (offset === 0) throw new Lz4Error("offset cannot be 0");
    if (offset > dstPos) throw new Lz4Error("offset points before start of output");

    let matchLen = (token & 0x0f) + MIN_MATCH;
    if ((token & 0x0f) === 15) {
      let extra: number;
      do {
        if (srcPos >= src.length) throw new Lz4Error("unexpected end of block in match length");
        extra = src[srcPos++];
        matchLen += extra;
      } while (extra === 255);
    }

    ensureCapacity(matchLen);

    let matchPos = dstPos - offset;
    for (let i = 0; i < matchLen; i++) {
      dst[dstPos++] = dst[matchPos++];
    }
  }

  return dst.subarray(0, dstPos);
}

export function compressBlock(src: Uint8Array): Uint8Array {
  const out = new GrowableBuffer(src.length + (src.length >> 8) + 16);
  const table = new Int32Array(1 << HASH_BITS).fill(-1);

  let ip = 0;
  let anchor = 0;
  const ipEnd = src.length;
  const mflimit = ipEnd - MF_LIMIT;

  while (ip < mflimit) {
    const sequence = src[ip] | (src[ip + 1] << 8) | (src[ip + 2] << 16) | (src[ip + 3] << 24);
    const hash = ((sequence * 2654435761) >>> (32 - HASH_BITS)) & ((1 << HASH_BITS) - 1);
    const ref = table[hash];
    table[hash] = ip;

    if (
      ref >= 0 &&
      ip - ref <= MAX_OFFSET &&
      src[ref] === src[ip] &&
      src[ref + 1] === src[ip + 1] &&
      src[ref + 2] === src[ip + 2] &&
      src[ref + 3] === src[ip + 3]
    ) {
      // Found match
      const litLen = ip - anchor;
      let token = Math.min(litLen, 15) << 4;

      let matchLen = 4;
      while (ip + matchLen < ipEnd - LAST_LITERALS && src[ref + matchLen] === src[ip + matchLen]) {
        matchLen++;
      }

      const matchCode = Math.min(matchLen - MIN_MATCH, 15);
      token |= matchCode;
      out.push(token);

      if (litLen >= 15) {
        let rem = litLen - 15;
        while (rem >= 255) {
          out.push(255);
          rem -= 255;
        }
        out.push(rem);
      }
      out.set(src.subarray(anchor, ip));

      const offset = ip - ref;
      out.push(offset & 0xff);
      out.push((offset >> 8) & 0xff);

      if (matchLen - MIN_MATCH >= 15) {
        let rem = matchLen - MIN_MATCH - 15;
        while (rem >= 255) {
          out.push(255);
          rem -= 255;
        }
        out.push(rem);
      }

      ip += matchLen;
      anchor = ip;
    } else {
      ip++;
    }
  }

  // Trailing literals
  const lastLitLen = ipEnd - anchor;
  out.push(Math.min(lastLitLen, 15) << 4);
  if (lastLitLen >= 15) {
    let rem = lastLitLen - 15;
    while (rem >= 255) {
      out.push(255);
      rem -= 255;
    }
    out.push(rem);
  }
  out.set(src.subarray(anchor, ipEnd));

  return out.finish();
}
