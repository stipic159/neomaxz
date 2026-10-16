import { test, describe } from 'node:test';
import assert from 'node:assert';
import tls from 'node:tls';
import { WebSocket } from 'ws';
import { RUSSIAN_CA_CERTS } from '../src/protocol/ca.js';
import { encodeFrame, decodeFrame } from '../src/protocol/frame.js';
import { Command, OPCODES, PROTOCOL_VERSION, DEFAULT_WEBSOCKET_URL, DEFAULT_ORIGIN } from '../src/protocol/opcodes.js';

describe('MAX Live Server Handshake Integration Test', () => {
  test('Live TLS handshake and PING/PONG roundtrip over WebSocket', async () => {
    const ca = [...tls.rootCertificates, ...RUSSIAN_CA_CERTS];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(DEFAULT_WEBSOCKET_URL, {
        ca,
        headers: { Origin: DEFAULT_ORIGIN },
        handshakeTimeout: 10000,
      });

      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('Connection timed out after 10s'));
      }, 10000);

      ws.on('open', () => {
        // Send a 10-byte binary PING frame
        const pingFrame = encodeFrame({
          seq: 1,
          opcode: OPCODES.PING,
          cmd: Command.REQUEST,
        });
        ws.send(pingFrame);
      });

      ws.on('message', (data) => {
        clearTimeout(timer);
        const buf = Buffer.from(data as Buffer);
        const frame = decodeFrame(buf);

        assert.strictEqual(frame.ver, PROTOCOL_VERSION);
        assert.strictEqual(frame.cmd, Command.RESPONSE);
        assert.strictEqual(frame.seq, 1);
        assert.strictEqual(frame.opcode, OPCODES.PING);

        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });
});
