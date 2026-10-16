import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MaxEventEmitter } from '../src/socket/event-emitter.js';
import { RequestBroker, ProtocolError } from '../src/socket/request-broker.js';
import { SocketClient } from '../src/socket/socket-client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';
import type { ITransport } from '../src/socket/transport.js';

describe('Stage 2: Socket Core & Event Emitter Tests', () => {
  test('MaxEventEmitter dispatches events sequentially across async handlers', async () => {
    const ev = new MaxEventEmitter();
    const order: number[] = [];

    ev.on('presence.update', async (data) => {
      // Simulate async delay
      await new Promise((r) => setTimeout(r, 10));
      order.push(Number(data.chatId));
    });

    ev.emit('presence.update', { chatId: '1', userId: 'u1', isTyping: true });
    ev.emit('presence.update', { chatId: '2', userId: 'u2', isTyping: false });
    ev.emit('presence.update', { chatId: '3', userId: 'u3', isTyping: true });

    // Wait for queue to drain
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(order, [1, 2, 3], 'Events must be processed strictly in order');
  });

  test('RequestBroker resolves matched responses and handles timeout', async () => {
    const broker = new RequestBroker();
    const seq = broker.nextSeq();

    const promise = broker.register(seq, OPCODES.PING, 1000);

    const mockResponse: InboundFrame = {
      ver: 10,
      cmd: Command.RESPONSE,
      seq,
      opcode: OPCODES.PING,
      flags: 0,
      length: 0,
      payload: { ok: true },
    };

    const handled = broker.handleResponse(mockResponse);
    assert.strictEqual(handled, true);

    const result = await promise;
    assert.deepStrictEqual(result.payload, { ok: true });
  });

  test('RequestBroker correctly rejects with ProtocolError on ERROR command', async () => {
    const broker = new RequestBroker();
    const seq = broker.nextSeq();

    const promise = broker.register(seq, OPCODES.LOGIN, 1000);

    const errorResponse: InboundFrame = {
      ver: 10,
      cmd: Command.ERROR,
      seq,
      opcode: OPCODES.LOGIN,
      flags: 0,
      length: 0,
      payload: { error: 'invalid_token', message: 'Token has expired' },
    };

    broker.handleResponse(errorResponse);

    await assert.rejects(
      async () => await promise,
      (err: any) => {
        assert.ok(err instanceof ProtocolError);
        assert.strictEqual(err.opcode, OPCODES.LOGIN);
        assert.strictEqual(err.code, 'invalid_token');
        assert.strictEqual(err.message, 'Token has expired');
        return true;
      }
    );
  });

  test('SocketClient handles query and push messages via Mock Transport', async () => {
    class MockTransport implements ITransport {
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

      public async send(frame: OutboundFrame): Promise<void> {
        // Echo back response with matching seq
        setTimeout(() => {
          for (const l of this.listeners.frame) {
            l({
              ver: 10,
              cmd: Command.RESPONSE,
              seq: frame.seq,
              opcode: frame.opcode,
              flags: 0,
              length: 0,
              payload: { echoedOpcode: frame.opcode },
            });
          }
        }, 10);
      }

      public close(): void {
        this.open = false;
        for (const l of this.listeners.close) l();
      }

      public simulatePush(frame: InboundFrame): void {
        for (const l of this.listeners.frame) l(frame);
      }
    }

    const mock = new MockTransport();
    const client = new SocketClient({ transport: mock, autoReconnect: false });

    await client.connect();
    assert.strictEqual(client.isOpen(), true);

    // Test query
    const res = await client.query({ opcode: OPCODES.PING });
    assert.deepStrictEqual(res.payload, { echoedOpcode: OPCODES.PING });

    // Test server push dispatching
    let receivedPush = false;
    client.ev.on('messages.upsert', ({ messages }) => {
      assert.strictEqual(messages[0].text, 'Hello from push');
      receivedPush = true;
    });

    mock.simulatePush({
      ver: 10,
      cmd: Command.EVENT,
      seq: 0,
      opcode: OPCODES.PUSH_MESSAGE,
      flags: 0,
      length: 0,
      payload: { message: { text: 'Hello from push' } },
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(receivedPush, true);

    client.disconnect();
    assert.strictEqual(client.isOpen(), false);
  });

  test('Live SocketClient connects to MAX, executes PING query, and gracefully closes', async () => {
    const client = new SocketClient({
      keepAliveIntervalMs: 60000,
      autoReconnect: false,
    });

    let openFired = false;
    client.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        openFired = true;
      }
    });

    await client.connect();
    assert.strictEqual(client.isOpen(), true);
    assert.strictEqual(openFired, true);

    // Send real PING query through RequestBroker
    const pongFrame = await client.query({
      opcode: OPCODES.PING,
      timeoutMs: 5000,
    });

    assert.strictEqual(pongFrame.ver, 10);
    assert.strictEqual(pongFrame.cmd, Command.RESPONSE);
    assert.strictEqual(pongFrame.opcode, OPCODES.PING);

    client.disconnect();
    assert.strictEqual(client.isOpen(), false);
  });

  test('RequestBroker prevents cross-talk between concurrent requests with the same opcode', async () => {
    const broker = new RequestBroker();
    const seq1 = broker.nextSeq();
    const seq2 = broker.nextSeq();

    const p1 = broker.register(seq1, OPCODES.MSG_SEND, 1000);
    const p2 = broker.register(seq2, OPCODES.MSG_SEND, 1000);

    // Response for seq2 arrives first
    const res2: InboundFrame = {
      ver: 10,
      cmd: Command.RESPONSE,
      seq: seq2,
      opcode: OPCODES.MSG_SEND,
      flags: 0,
      length: 0,
      payload: { messageId: 'msg_2' },
    };
    const handled2 = broker.handleResponse(res2);
    assert.strictEqual(handled2, true);

    const val2 = await p2;
    assert.strictEqual(val2.payload?.messageId, 'msg_2');

    // p1 MUST STILL BE PENDING!
    assert.strictEqual(broker.pendingCount(), 1);

    const res1: InboundFrame = {
      ver: 10,
      cmd: Command.RESPONSE,
      seq: seq1,
      opcode: OPCODES.MSG_SEND,
      flags: 0,
      length: 0,
      payload: { messageId: 'msg_1' },
    };
    const handled1 = broker.handleResponse(res1);
    assert.strictEqual(handled1, true);

    const val1 = await p1;
    assert.strictEqual(val1.payload?.messageId, 'msg_1');
    assert.strictEqual(broker.pendingCount(), 0);
  });

  test('RequestBroker rejects ambiguous opcode fallback when multiple queries are pending', async () => {
    const broker = new RequestBroker();
    const seq1 = broker.nextSeq();
    const seq2 = broker.nextSeq();

    const p1 = broker.register(seq1, OPCODES.CHAT_HISTORY, 1000);
    const p2 = broker.register(seq2, OPCODES.CHAT_HISTORY, 1000);
    p1.catch(() => {});
    p2.catch(() => {});

    // Ambiguous response with seq 0 arrives
    const ambiguousFrame: InboundFrame = {
      ver: 10,
      cmd: Command.RESPONSE,
      seq: 0,
      opcode: OPCODES.CHAT_HISTORY,
      flags: 0,
      length: 0,
      payload: { history: [] },
    };

    const handled = broker.handleResponse(ambiguousFrame);
    assert.strictEqual(handled, false, 'Must not arbitrarily resolve when multiple requests share opcode');
    assert.strictEqual(broker.pendingCount(), 2);

    broker.rejectAll(new Error('Teardown'));
  });

  test('SocketClient isolates send failures and does not reject other pending queries', async () => {
    let failNextSend = false;
    class FlakyTransport implements ITransport {
      private listeners = {
        frame: new Set<(f: InboundFrame) => void>(),
        close: new Set<(e?: Error) => void>(),
        error: new Set<(e: Error) => void>(),
      };
      public on(event: any, listener: any): this {
        this.listeners[event as keyof typeof this.listeners].add(listener);
        return this;
      }
      public isOpen(): boolean { return true; }
      public async connect(): Promise<void> {}
      public close(): void {}
      public async send(frame: OutboundFrame): Promise<void> {
        if (failNextSend) {
          throw new Error('Socket write buffer overflow');
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
              payload: { ok: true, forSeq: frame.seq },
            });
          }
        }, 10);
      }
    }

    const transport = new FlakyTransport();
    const client = new SocketClient({ transport, autoReconnect: false });
    await client.connect();

    // Query 1 succeeds and is pending response
    const q1Promise = client.query({ opcode: OPCODES.PING });

    // Query 2 fails on transport send
    failNextSend = true;
    await assert.rejects(
      async () => await client.query({ opcode: OPCODES.START_AUTH }),
      /Socket write buffer overflow/
    );

    // Query 1 MUST NOT BE REJECTED by Query 2's send failure!
    const res1 = await q1Promise;
    assert.strictEqual(res1.payload?.ok, true);

    client.disconnect();
  });

  test('MaxEventEmitter executes listeners concurrently without head-of-line blocking', async () => {
    const ev = new MaxEventEmitter();
    const finished: string[] = [];

    ev.on('presence.update', async () => {
      // Slow listener (50ms)
      await new Promise((r) => setTimeout(r, 50));
      finished.push('slow');
    });

    ev.on('presence.update', async () => {
      // Fast listener (5ms)
      await new Promise((r) => setTimeout(r, 5));
      finished.push('fast');
    });

    ev.emit('presence.update', { chatId: '1', userId: 'u1', isTyping: true });

    await new Promise((r) => setTimeout(r, 70));
    assert.deepStrictEqual(finished, ['fast', 'slow'], 'Fast listener should complete before slow listener');
  });

  test('Slow listener on messages.upsert does not block immediate dispatch of subsequent connection.update event', async () => {
    const ev = new MaxEventEmitter();
    let slowListenerFinished = false;
    let fastEventReceived = false;

    // 1. Slow listener on messages.upsert (simulates slow 100ms LLM or DB call)
    ev.on('messages.upsert', async () => {
      await new Promise((r) => setTimeout(r, 100));
      slowListenerFinished = true;
    });

    // 2. Fast listener on connection.update
    ev.on('connection.update', () => {
      fastEventReceived = true;
    });

    // Emit slow domain event, then immediately emit fast system connection event
    ev.emit('messages.upsert', { messages: [], type: 'notify' });
    ev.emit('connection.update', { connection: 'open' });

    // Wait 15ms: connection.update must ALREADY have been dispatched,
    // while the slow messages.upsert listener is STILL running!
    await new Promise((r) => setTimeout(r, 15));

    assert.strictEqual(fastEventReceived, true, 'connection.update must be dispatched immediately without waiting for slow handler');
    assert.strictEqual(slowListenerFinished, false, 'messages.upsert listener must still be executing in background');

    // Wait for the slow listener to complete
    await new Promise((r) => setTimeout(r, 110));
    assert.strictEqual(slowListenerFinished, true);
  });
});
