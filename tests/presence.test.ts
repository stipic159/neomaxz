import { test, describe } from 'node:test';
import assert from 'node:assert';
import { makeMaxSocket } from '../src/client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { ITransport } from '../src/socket/transport.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';

describe('Presence & Typing Tests (T4)', () => {
  class MockTransport implements ITransport {
    public sentFrames: OutboundFrame[] = [];
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

      setTimeout(() => {
        for (const l of this.listeners.frame) {
          l({
            ver: 10,
            cmd: Command.RESPONSE,
            seq: frame.seq,
            opcode: frame.opcode,
            flags: 0,
            length: 0,
            payload: { ok: true },
          });
        }
      }, 5);
    }

    public emitPush(opcode: number, payload: Record<string, any>): void {
      for (const l of this.listeners.frame) {
        l({
          ver: 10,
          cmd: Command.EVENT,
          seq: 0,
          opcode,
          flags: 0,
          length: 0,
          payload,
        });
      }
    }
  }

  const mockAuth = {
    creds: {
      deviceId: 'dev_1',
      sessionToken: 'tok_1',
      userId: '1001',
    },
    keys: {},
  };

  test('sock.sendPresence sends 0x004a with appropriate action and boolean flag', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    await sock.sendPresence('500', 'typing');
    let frame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_TYPING);
    assert.ok(frame);
    assert.strictEqual(frame.payload?.chatId, 500n);
    assert.strictEqual(frame.payload?.action, 'TYPING');
    assert.strictEqual(frame.payload?.typing, true);

    transport.sentFrames = [];
    await sock.sendPresence('500', 'paused');
    frame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_TYPING);
    assert.ok(frame);
    assert.strictEqual(frame.payload?.chatId, 500n);
    assert.strictEqual(frame.payload?.action, 'PAUSED');
    assert.strictEqual(frame.payload?.typing, false);
  });

  test('sock.simulateTyping sends typing, waits delay, then sends paused', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    await sock.simulateTyping('500', 50, 'recording_audio');

    const typingFrames = transport.sentFrames.filter((f) => f.opcode === OPCODES.MSG_TYPING);
    assert.strictEqual(typingFrames.length, 2);
    assert.strictEqual(typingFrames[0].payload?.action, 'RECORDING_AUDIO');
    assert.strictEqual(typingFrames[0].payload?.typing, true);
    assert.strictEqual(typingFrames[1].payload?.action, 'PAUSED');
    assert.strictEqual(typingFrames[1].payload?.typing, false);
  });

  test('Incoming PUSH_TYPING emits enriched presence.update event', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    let receivedUpdate: any = null;
    sock.ev.on('presence.update', (update) => {
      receivedUpdate = update;
    });

    transport.emitPush(OPCODES.PUSH_TYPING, {
      chatId: '777',
      userId: '2002',
      action: 'RECORDING_AUDIO',
      typing: true,
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.ok(receivedUpdate);
    assert.strictEqual(receivedUpdate.chatId, '777');
    assert.strictEqual(receivedUpdate.userId, '2002');
    assert.strictEqual(receivedUpdate.action, 'recording_audio');
    assert.strictEqual(receivedUpdate.isTyping, true);
  });
});
