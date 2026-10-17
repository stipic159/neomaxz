import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { makeMaxSocket } from '../src/client.js';
import { useMultiFileAuthState } from '../src/session/file-auth.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';
import type { ITransport } from '../src/socket/transport.js';

describe('Stage 4 & 5: makeMaxSocket & High-Level API Tests', () => {
  const tempDir = path.join(os.tmpdir(), `max-test-client-${Date.now()}`);

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('makeMaxSocket full lifecycle: connect -> sendMessage -> edit -> delete -> push -> logout', async () => {
    class MockClientTransport implements ITransport {
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
        let payload: Record<string, any> = {};

        switch (frame.opcode) {
          case OPCODES.INIT:
            payload = { ok: true };
            break;

          case OPCODES.LOGIN:
            payload = {
              profile: { id: 1001, firstName: 'Antigravity User' },
              chats: [{ id: 500, title: 'Dev Chat' }],
            };
            break;

          case OPCODES.MSG_SEND:
            assert.strictEqual(frame.payload?.message?.text, 'Hello from Baileys!');
            payload = {
              message: {
                id: 999999999123n,
                time: 1720000000,
                text: frame.payload?.message?.text,
              },
            };
            break;

          case OPCODES.MSG_EDIT:
            assert.strictEqual(frame.payload?.text, 'Updated text');
            payload = { success: true };
            break;

          case OPCODES.MSG_DELETE:
            assert.deepStrictEqual(frame.payload?.messageIds, [999999999123n]);
            payload = { success: true };
            break;

          case 0x0044: // MSG_REACTION
            assert.strictEqual(frame.payload?.reaction?.id, '👍');
            payload = { success: true };
            break;

          case 0x0046: // MSG_CANCEL_REACTION
            payload = { success: true };
            break;

          case OPCODES.LOGOUT:
            payload = { ok: true };
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

      public triggerPush(frame: InboundFrame): void {
        for (const l of this.listeners.frame) {
          l(frame);
        }
      }
    }

    const { state } = await useMultiFileAuthState(tempDir);
    state.creds.sessionToken = 'initial_session_token';

    const mockTransport = new MockClientTransport();
    const sock = makeMaxSocket({
      auth: state,
      transport: mockTransport,
      autoReconnect: false,
    });

    // 1. Connect (triggers INIT and auto-LOGIN because sessionToken is present)
    await sock.connect();
    assert.strictEqual(sock.user.id, '1001');
    assert.strictEqual(sock.user.name, 'Antigravity User');

    // 2. Send Message
    const sent = await sock.sendMessage('500', { text: 'Hello from Baileys!' });
    assert.strictEqual(sent.id, '999999999123');
    assert.strictEqual(sent.text, 'Hello from Baileys!');
    assert.strictEqual(sent.fromMe, true);
    assert.strictEqual(sent.key.chatId, '500');

    // 3. Edit Message
    await sock.editMessage('500', sent.id, 'Updated text');

    // 4. Reactions
    await sock.addReaction('500', sent.id, '👍');
    await sock.removeReaction('500', sent.id);

    // 5. Delete Message
    await sock.deleteMessages('500', [sent.id]);

    // 6. Incoming push handling: must be emitted EXACTLY ONCE and fully normalized
    let receivedUpsertCount = 0;
    sock.ev.on('messages.upsert', ({ messages }) => {
      receivedUpsertCount++;
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].text, 'Incoming test message');
      assert.strictEqual(messages[0].senderId, '2002');
      assert.strictEqual(messages[0].fromMe, false);
      assert.strictEqual(messages[0].key.chatId, '500');
    });

    mockTransport.triggerPush({
      ver: 10,
      cmd: Command.EVENT,
      seq: 0,
      opcode: OPCODES.PUSH_MESSAGE,
      flags: 0,
      length: 0,
      payload: {
        chatId: 500,
        sender: { id: 2002, name: 'Alice' },
        message: {
          id: 888888888123n,
          text: 'Incoming test message',
          time: 1720000050,
        },
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(receivedUpsertCount, 1, 'messages.upsert must be emitted exactly ONCE per push');

    // 7. Logout & End
    await sock.logout();
    assert.strictEqual(sock.authState.creds.sessionToken, undefined);

    sock.end();
  });

  test('Auto-reconnect automatically re-authenticates with INIT and LOGIN before setting status to open', async () => {
    let initCalls = 0;
    let loginCalls = 0;

    class ReconnectMockTransport implements ITransport {
      private open = false;
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
        return this.open;
      }
      public async connect(): Promise<void> {
        this.open = true;
      }
      public close(err?: Error): void {
        this.open = false;
        for (const l of this.listeners.close) l(err);
      }
      public async send(frame: OutboundFrame): Promise<void> {
        let payload: Record<string, any> = {};

        if (frame.opcode === OPCODES.INIT) {
          initCalls++;
          payload = { ok: true };
        } else if (frame.opcode === OPCODES.LOGIN) {
          loginCalls++;
          payload = {
            profile: { id: 5555, firstName: 'Reconnected User' },
            chats: [],
          };
        } else if (frame.opcode === OPCODES.MSG_SEND) {
          payload = { message: { id: 777111n, text: 'post reconnect' } };
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

    const { state } = await useMultiFileAuthState(tempDir);
    state.creds.sessionToken = 'persisted_valid_token';

    const transport = new ReconnectMockTransport();
    const sock = makeMaxSocket({
      auth: state,
      transport,
      autoReconnect: true,
      maxReconnectDelayMs: 50,
    });

    const statusHistory: string[] = [];
    sock.ev.on('connection.update', (update) => {
      if (update.connection) {
        statusHistory.push(update.connection);
      }
    });

    // 1. Initial connect: runs INIT (1) and LOGIN (1)
    await sock.connect();
    assert.strictEqual(initCalls, 1);
    assert.strictEqual(loginCalls, 1);
    assert.strictEqual(sock.user.id, '5555');
    assert.strictEqual(statusHistory[statusHistory.length - 1], 'open');

    // 2. Abrupt network drop
    transport.close(new Error('Connection reset by peer'));
    assert.strictEqual(sock.rawClient.isOpen(), false);
    assert.strictEqual(sock.rawClient.getStatus(), 'close');
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(statusHistory[statusHistory.length - 1], 'close');

    // 3. Await auto-reconnect (delay ~50ms + jitter)
    await new Promise((r) => setTimeout(r, 1200));

    // 4. Verify that INIT and LOGIN were both re-executed!
    assert.strictEqual(initCalls, 2, 'INIT must be called on reconnect');
    assert.strictEqual(loginCalls, 2, 'LOGIN must be called on reconnect to restore session');
    assert.strictEqual(sock.rawClient.isOpen(), true);
    assert.strictEqual(statusHistory[statusHistory.length - 1], 'open');

    // 5. Send message on reconnected socket to verify fully authenticated state
    const sent = await sock.sendMessage('100', { text: 'post reconnect' });
    assert.strictEqual(sent.id, '777111');

    sock.end();
  });
});
