import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseMarkdown } from '../src/messages/formatting.js';
import { makeMaxSocket } from '../src/client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { ITransport } from '../src/socket/transport.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';

describe('Advanced Messaging & Formatting Tests', () => {
  describe('parseMarkdown unit tests', () => {
    test('parses plain text without formatting', () => {
      const res = parseMarkdown('Hello world!');
      assert.strictEqual(res.text, 'Hello world!');
      assert.deepStrictEqual(res.elements, []);
    });

    test('parses bold, italic, and strikethrough correctly', () => {
      const input = 'This is *bold* and _italic_ and ~strike~';
      const res = parseMarkdown(input);

      assert.strictEqual(res.text, 'This is bold and italic and strike');
      assert.strictEqual(res.elements.length, 3);

      assert.deepStrictEqual(res.elements[0], {
        type: 'BOLD',
        offset: 8,
        length: 4,
        url: undefined,
        userId: undefined,
      });

      assert.deepStrictEqual(res.elements[1], {
        type: 'ITALIC',
        offset: 17,
        length: 6,
        url: undefined,
        userId: undefined,
      });

      assert.deepStrictEqual(res.elements[2], {
        type: 'STRIKETHROUGH',
        offset: 28,
        length: 6,
        url: undefined,
        userId: undefined,
      });
    });

    test('parses inline code, code blocks, and spoilers', () => {
      const input = 'Check `code` and ||secret|| and ```const x = 1;```';
      const res = parseMarkdown(input);

      assert.strictEqual(res.text, 'Check code and secret and const x = 1;');
      const types = res.elements.map((e) => e.type);
      assert.deepStrictEqual(types, ['CODE', 'SPOILER', 'PRE']);
    });

    test('parses links and mentions', () => {
      const input = 'Visit [GitHub](https://github.com) or talk to @john and @12345';
      const res = parseMarkdown(input);

      assert.strictEqual(res.text, 'Visit GitHub or talk to @john and @12345');
      
      const linkEl = res.elements.find((e) => e.type === 'LINK');
      assert.ok(linkEl);
      assert.strictEqual(linkEl.url, 'https://github.com');
      assert.strictEqual(linkEl.length, 6);

      const userMention = res.elements.find((e) => e.userId === '12345');
      assert.ok(userMention);
      assert.strictEqual(userMention.type, 'MENTION');
    });
  });

  describe('makeMaxSocket advanced messaging commands via MockTransport', () => {
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

        let payload: Record<string, any> = { success: true };
        if (frame.opcode === OPCODES.MSG_SEND) {
          payload = {
            message: {
              id: 888888888123n,
              time: Date.now(),
              text: frame.payload?.message?.text,
            },
          };
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

    test('sock.markChatRead sends 0x0045 MSG_READ', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      await sock.markChatRead('500', ['10', '11'], 1720000000000);

      const readFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_READ);
      assert.ok(readFrame);
      assert.strictEqual(readFrame.payload?.chatId, 500n);
      assert.deepStrictEqual(readFrame.payload?.messageIds, [10n, 11n]);
      assert.strictEqual(readFrame.payload?.markTime, 1720000000000n);
    });

    test('sock.pinMessage and sock.unpinMessage send 0x0047 and 0x0048', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      await sock.pinMessage('500', '999', true);
      const pinFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_PIN);
      assert.ok(pinFrame);
      assert.strictEqual(pinFrame.payload?.chatId, 500n);
      assert.strictEqual(pinFrame.payload?.messageId, 999n);
      assert.strictEqual(pinFrame.payload?.notify, true);

      await sock.unpinMessage('500', '999');
      const unpinFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_UNPIN);
      assert.ok(unpinFrame);
      assert.strictEqual(unpinFrame.payload?.chatId, 500n);
      assert.strictEqual(unpinFrame.payload?.messageId, 999n);
    });

    test('sock.sendCallback sends 0x0076 MSG_CALLBACK', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      await sock.sendCallback('500', '1234', 'cb_42', 'confirm');
      const cbFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_CALLBACK);
      assert.ok(cbFrame);
      assert.strictEqual(cbFrame.payload?.chatId, 500n);
      assert.strictEqual(cbFrame.payload?.messageId, 1234n);
      assert.strictEqual(cbFrame.payload?.callbackId, 'cb_42');
      assert.strictEqual(cbFrame.payload?.payload, 'confirm');
    });

    test('sock.sendMessage parses markdown and sends elements automatically', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      await sock.sendMessage('500', {
        text: 'Hello *world*!',
      });

      const sendFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_SEND);
      assert.ok(sendFrame);
      assert.strictEqual(sendFrame.payload?.message?.text, 'Hello world!');
      assert.strictEqual(sendFrame.payload?.message?.elements?.length, 1);
      assert.strictEqual(sendFrame.payload?.message?.elements?.[0]?.type, 'BOLD');
    });

    test('sock.sendMessage formats buttons and polls', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      await sock.sendMessage('500', {
        text: 'Poll Question',
        buttons: [
          [{ type: 'CALLBACK', text: 'Vote', payload: 'vote_1' }],
        ],
        poll: {
          question: 'Do you like TypeScript?',
          options: ['Yes', 'Of course'],
          multipleAnswers: false,
        },
        sendAt: 1800000000000,
      });

      const sendFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.MSG_SEND);
      assert.ok(sendFrame);
      const attaches = sendFrame.payload?.message?.attaches;
      assert.strictEqual(attaches.length, 2);

      const keyboardAttach = attaches.find((a: any) => a.type === 'INLINE_KEYBOARD');
      assert.ok(keyboardAttach);
      assert.strictEqual(keyboardAttach.buttons[0][0].payload, 'vote_1');

      const pollAttach = attaches.find((a: any) => a.type === 'POLL');
      assert.ok(pollAttach);
      assert.strictEqual(pollAttach.options.length, 2);
      assert.strictEqual(pollAttach.options[0].text, 'Yes');

      assert.strictEqual(sendFrame.payload?.sendAt, 1800000000000n);
    });

    test('Server push 0x0088 emits messages.read event', async () => {
      const transport = new MockTransport();
      const sock = makeMaxSocket({ auth: mockAuth as any, transport });
      await sock.connect();

      let receivedReadReceipt: any = null;
      sock.ev.on('messages.read', (receipt) => {
        receivedReadReceipt = receipt;
      });

      transport.emitPush(OPCODES.PUSH_READ, {
        chatId: '500',
        userId: '2002',
        messageIds: ['100', '101'],
        markTime: 1720000000,
      });

      await new Promise((r) => setTimeout(r, 10));
      assert.ok(receivedReadReceipt);
      assert.strictEqual(receivedReadReceipt.chatId, '500');
      assert.strictEqual(receivedReadReceipt.userId, '2002');
      assert.deepStrictEqual(receivedReadReceipt.messageIds, ['100', '101']);
    });
  });
});
