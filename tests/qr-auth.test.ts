import { test, describe } from 'node:test';
import assert from 'node:assert';
import { makeMaxSocket } from '../src/client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { ITransport } from '../src/socket/transport.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';

describe('QR Code Authorization Tests (T1)', () => {
  class MockTransport implements ITransport {
    public sentFrames: OutboundFrame[] = [];
    public pollAttempts = 0;
    public pollMode: 'success' | 'expired' = 'success';

    private listeners = {
      frame: new Set<(f: InboundFrame) => void>(),
      close: new Set<(e?: Error) => void>(),
      error: new Set<(e: Error) => void>(),
    };

    public on(event: any, listener: any): this {
      this.listeners[event as keyof typeof this.listeners].add(listener);
      return this;
    }
    public isOpen(): boolean {
      return true;
    }
    public async connect(): Promise<void> {}
    public close(): void {}

    public async send(frame: OutboundFrame): Promise<void> {
      this.sentFrames.push(frame);

      let payload: Record<string, any> = { ok: true };

      switch (frame.opcode) {
        case OPCODES.QR_LOGIN_START:
          payload = {
            qr: 'https://web.max.ru/qr/sample-token-abc',
            trackId: 'track_qr_123',
          };
          break;

        case OPCODES.QR_LOGIN_CHECK:
          this.pollAttempts++;
          if (this.pollMode === 'expired') {
            payload = { status: 'expired' };
          } else if (this.pollAttempts === 1) {
            payload = { status: 'pending' };
          } else {
            payload = {
              loginToken: 'sess_token_from_qr_scanner_9999999999',
            };
          }
          break;

        case OPCODES.LOGIN:
          payload = {
            profile: { id: 8008, firstName: 'QR User' },
          };
          break;
      }

      setTimeout(() => {
        for (const l of this.listeners.frame) {
          l({
            ver: 10,
            cmd: Command.RESPONSE,
            seq: frame.seq,
            opcode: frame.opcode,
            flags: 0,
            length: 0,
            payload,
          });
        }
      }, 5);
    }
  }

  const mockAuth = {
    creds: {
      deviceId: 'dev_qr_test',
    },
    keys: {},
  };

  test('sock.requestQrCode emits connection.update with qr and returns trackId', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    let receivedQr: string | undefined;
    sock.ev.on('connection.update', (update) => {
      if (update.qr) receivedQr = update.qr;
    });

    const res = await sock.requestQrCode();
    assert.strictEqual(res.qr, 'https://web.max.ru/qr/sample-token-abc');
    assert.strictEqual(res.trackId, 'track_qr_123');
    assert.strictEqual(receivedQr, 'https://web.max.ru/qr/sample-token-abc');
  });

  test('sock.pollQrStatus polls until loginToken received and logs in', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const { trackId } = await sock.requestQrCode();
    const res = await sock.pollQrStatus(trackId, { intervalMs: 20 });

    assert.strictEqual(res.sessionToken, 'sess_token_from_qr_scanner_9999999999');
    assert.strictEqual(sock.authState.creds.sessionToken, 'sess_token_from_qr_scanner_9999999999');
    assert.ok(transport.pollAttempts >= 2);
  });

  test('sock.pollQrStatus throws on expired QR status', async () => {
    const transport = new MockTransport();
    transport.pollMode = 'expired';
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const { trackId } = await sock.requestQrCode();
    await assert.rejects(
      async () => {
        await sock.pollQrStatus(trackId, { intervalMs: 20 });
      },
      /QR code authorization expired/
    );
  });
});
