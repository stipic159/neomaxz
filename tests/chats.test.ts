import { test, describe } from 'node:test';
import assert from 'node:assert';
import { makeMaxSocket } from '../src/client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { ITransport } from '../src/socket/transport.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';

describe('Chats & Groups Administration Tests (T2)', () => {
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

      switch (frame.opcode) {
        case OPCODES.CHATS_LIST:
          payload = {
            chats: [
              { id: 501n, title: 'Devs', type: 'GROUP', unreadCount: 3 },
              { id: 502n, title: 'News Channel', type: 'CHANNEL', unreadCount: 0 },
            ],
          };
          break;

        case OPCODES.CHAT_INFO:
          assert.strictEqual(frame.payload?.chatId, 501n);
          payload = {
            chat: {
              id: 501n,
              title: 'Devs',
              type: 'GROUP',
              description: 'Developers chat',
              membersCount: 42,
            },
          };
          break;

        case OPCODES.CHAT_CREATE:
          assert.strictEqual(frame.payload?.title, 'New Team');
          assert.deepStrictEqual(frame.payload?.userIds, [10n, 11n]);
          payload = {
            chat: {
              id: 999n,
              title: 'New Team',
              type: 'GROUP',
            },
          };
          break;

        case OPCODES.CHAT_SET_INFO:
          assert.strictEqual(frame.payload?.chatId, 501n);
          assert.strictEqual(frame.payload?.title, 'Updated Title');
          payload = { ok: true };
          break;

        case OPCODES.CHAT_MEMBERS:
          if (frame.payload?.action === 'ADD') {
            assert.deepStrictEqual(frame.payload?.userIds, [12n]);
            payload = { ok: true };
          } else if (frame.payload?.action === 'REMOVE') {
            assert.strictEqual(frame.payload?.userId, 12n);
            payload = { ok: true };
          } else {
            payload = {
              members: [
                { userId: 1001n, name: 'Admin', role: 'ADMIN' },
                { userId: 1002n, name: 'User', role: 'MEMBER' },
              ],
            };
          }
          break;

        case OPCODES.CHAT_LEAVE:
          assert.strictEqual(frame.payload?.chatId, 501n);
          payload = { ok: true };
          break;

        case OPCODES.CHAT_DELETE:
          assert.strictEqual(frame.payload?.chatId, 501n);
          payload = { ok: true };
          break;

        case OPCODES.CHAT_INVITE_LINK:
          assert.strictEqual(frame.payload?.chatId, 501n);
          payload = { link: 'https://max.ru/join/abc123xyz' };
          break;

        case OPCODES.CHAT_JOIN_LINK:
          assert.strictEqual(frame.payload?.link, 'https://max.ru/join/abc123xyz');
          payload = {
            chat: {
              id: 501n,
              title: 'Devs',
              type: 'GROUP',
            },
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
      deviceId: 'dev_1',
      sessionToken: 'tok_1',
      userId: '1001',
    },
    keys: {},
  };

  test('sock.getChats and sock.getChat return normalized MaxChat objects', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const chats = await sock.getChats();
    assert.strictEqual(chats.length, 2);
    assert.strictEqual(chats[0].id, '501');
    assert.strictEqual(chats[0].type, 'GROUP');
    assert.strictEqual(chats[0].unreadCount, 3);
    assert.strictEqual(chats[1].type, 'CHANNEL');

    const chat = await sock.getChat('501');
    assert.strictEqual(chat.id, '501');
    assert.strictEqual(chat.description, 'Developers chat');
    assert.strictEqual(chat.membersCount, 42);
  });

  test('sock.createChat and sock.setChatInfo execute successfully', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const created = await sock.createChat({
      title: 'New Team',
      userIds: ['10', '11'],
    });
    assert.strictEqual(created.id, '999');
    assert.strictEqual(created.title, 'New Team');

    await sock.setChatInfo('501', { title: 'Updated Title' });
    const setInfoFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.CHAT_SET_INFO);
    assert.ok(setInfoFrame);
    assert.strictEqual(setInfoFrame.payload?.title, 'Updated Title');
  });

  test('sock.getChatMembers, addChatMembers, and removeChatMember work properly', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const members = await sock.getChatMembers('501');
    assert.strictEqual(members.length, 2);
    assert.strictEqual(members[0].role, 'ADMIN');

    await sock.addChatMembers('501', ['12']);
    await sock.removeChatMember('501', '12');

    const memberOps = transport.sentFrames.filter((f) => f.opcode === OPCODES.CHAT_MEMBERS);
    assert.strictEqual(memberOps.length, 3);
  });

  test('sock.leaveChat, deleteChat, createInviteLink, and joinByLink operate as expected', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    await sock.leaveChat('501');
    await sock.deleteChat('501');

    const link = await sock.createInviteLink('501');
    assert.strictEqual(link, 'https://max.ru/join/abc123xyz');

    const joinedChat = await sock.joinByLink(link);
    assert.strictEqual(joinedChat.id, '501');
    assert.strictEqual(joinedChat.title, 'Devs');
  });
});
