import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  encodeFrame,
  decodeFrame,
  decodeHeader,
  StreamFrameBuffer,
  HEADER_SIZE,
} from '../src/protocol/frame.js';
import { Command, OPCODES, PROTOCOL_VERSION } from '../src/protocol/opcodes.js';
import { compressBlock, decompressBlock } from '../src/protocol/lz4.js';

describe('MAX Protocol Frame & Codec Tests', () => {
  test('Header decoding works correctly', () => {
    const raw = Buffer.alloc(10);
    raw.writeUInt8(PROTOCOL_VERSION, 0);
    raw.writeUInt8(Command.REQUEST, 1);
    raw.writeUInt16BE(42, 2);
    raw.writeUInt16BE(OPCODES.PING, 4);
    raw.writeUInt32BE(0, 6); // flags = 0, len = 0

    const header = decodeHeader(raw);
    assert.strictEqual(header.ver, PROTOCOL_VERSION);
    assert.strictEqual(header.cmd, Command.REQUEST);
    assert.strictEqual(header.seq, 42);
    assert.strictEqual(header.opcode, OPCODES.PING);
    assert.strictEqual(header.flags, 0);
    assert.strictEqual(header.length, 0);
  });

  test('Encode and decode empty frame (e.g. PING)', () => {
    const encoded = encodeFrame({
      seq: 101,
      opcode: OPCODES.PING,
      cmd: Command.REQUEST,
    });

    assert.strictEqual(encoded.length, HEADER_SIZE);

    const decoded = decodeFrame(encoded);
    assert.strictEqual(decoded.ver, PROTOCOL_VERSION);
    assert.strictEqual(decoded.cmd, Command.REQUEST);
    assert.strictEqual(decoded.seq, 101);
    assert.strictEqual(decoded.opcode, OPCODES.PING);
    assert.strictEqual(decoded.payload, null);
  });

  test('Encode and decode frame with small MessagePack payload', () => {
    const payload = {
      phone: '+79991234567',
      type: 'sms',
    };

    const encoded = encodeFrame({
      seq: 202,
      opcode: OPCODES.START_AUTH,
      cmd: Command.REQUEST,
      payload,
    });

    const decoded = decodeFrame(encoded);
    assert.strictEqual(decoded.seq, 202);
    assert.strictEqual(decoded.opcode, OPCODES.START_AUTH);
    assert.deepStrictEqual(decoded.payload, payload);
  });

  test('Encode and decode frame with 64-bit BigInt IDs', () => {
    const payload = {
      chatId: 123456789012345678n,
      messageId: 987654321098765432n,
      text: 'Hello, World!',
    };

    const encoded = encodeFrame({
      seq: 303,
      opcode: OPCODES.MSG_SEND,
      cmd: Command.REQUEST,
      payload,
    });

    const decoded = decodeFrame(encoded);
    assert.strictEqual(decoded.seq, 303);
    assert.strictEqual(decoded.payload?.chatId, 123456789012345678n);
    assert.strictEqual(decoded.payload?.messageId, 987654321098765432n);
    assert.strictEqual(decoded.payload?.text, 'Hello, World!');
  });

  test('LZ4 compression and decompression roundtrip', () => {
    const originalText = 'Testing LZ4 block compression in pure TypeScript! '.repeat(20);
    const src = new TextEncoder().encode(originalText);
    const compressed = compressBlock(src);
    assert.ok(compressed.length < src.length, 'Compression should reduce size');

    const decompressed = decompressBlock(compressed, src.length);
    assert.deepStrictEqual(decompressed, src);
  });

  test('Encode and decode large compressed frame', () => {
    const largeText = 'Super long repeated text for LZ4 compression test '.repeat(50);
    const payload = {
      content: largeText,
      items: [1, 2, 3, 4, 5],
    };

    const encoded = encodeFrame({
      seq: 404,
      opcode: OPCODES.MSG_SEND,
      cmd: Command.REQUEST,
      payload,
      compress: true,
    });

    const decodedHeader = decodeHeader(encoded);
    assert.ok(decodedHeader.flags > 0, 'Flags should indicate compression factor');

    const decoded = decodeFrame(encoded);
    assert.strictEqual(decoded.seq, 404);
    assert.deepStrictEqual(decoded.payload, payload);
  });

  test('decompressBlock dynamically expands when initial buffer estimate is too small', () => {
    const longString = 'Dynamic expansion test for pure TS LZ4 '.repeat(100);
    const src = new TextEncoder().encode(longString);
    const compressed = compressBlock(src);

    // Provide an intentionally tiny initial buffer estimate (64 bytes for ~3900 bytes of output)
    const decompressed = decompressBlock(compressed, 64);
    assert.deepStrictEqual(decompressed, src);
  });

  test('decodeFrame handles compressed frames of various sizes without 8MB allocations', () => {
    for (const size of [50, 500, 5000]) {
      const payload = {
        data: 'sample_text_'.repeat(size),
        index: size,
      };
      const encoded = encodeFrame({
        seq: size,
        opcode: OPCODES.MSG_SEND,
        payload,
        compress: true,
      });

      const decoded = decodeFrame(encoded);
      assert.strictEqual(decoded.seq, size);
      assert.deepStrictEqual(decoded.payload, payload);
    }
  });

  test('StreamFrameBuffer handles fragmented TCP chunks correctly', () => {
    const stream = new StreamFrameBuffer();

    const frame1 = encodeFrame({
      seq: 1,
      opcode: OPCODES.PING,
      cmd: Command.REQUEST,
    });

    const frame2 = encodeFrame({
      seq: 2,
      opcode: OPCODES.START_AUTH,
      cmd: Command.REQUEST,
      payload: { test: 'chunking' },
    });

    const combined = Buffer.concat([Buffer.from(frame1), Buffer.from(frame2)]);

    // Feed chunk 1: half of frame 1
    stream.append(combined.subarray(0, 5));
    assert.strictEqual(stream.nextFrame(), null, 'Should not emit on incomplete header');

    // Feed chunk 2: rest of frame 1 and start of frame 2
    stream.append(combined.subarray(5, 15));
    const parsed1 = stream.nextFrame();
    assert.notStrictEqual(parsed1, null);
    assert.strictEqual(parsed1?.seq, 1);
    assert.strictEqual(stream.nextFrame(), null, 'Frame 2 is incomplete yet');

    // Feed chunk 3: remainder
    stream.append(combined.subarray(15));
    const parsed2 = stream.nextFrame();
    assert.notStrictEqual(parsed2, null);
    assert.strictEqual(parsed2?.seq, 2);
    assert.deepStrictEqual(parsed2?.payload, { test: 'chunking' });
    assert.strictEqual(stream.nextFrame(), null, 'Buffer should now be empty');
  });
});
