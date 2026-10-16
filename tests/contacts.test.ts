import { test, describe } from 'node:test';
import assert from 'node:assert';
import { makeMaxSocket } from '../src/client.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { ITransport } from '../src/socket/transport.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';

describe('Contacts & Profiles Tests (T3)', () => {
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
        case OPCODES.CONTACT_INFO_BY_PHONE:
          assert.strictEqual(frame.payload?.phone, '+79991234567');
          payload = {
            contact: {
              id: 2002n,
              firstName: 'Pavel',
              lastName: 'Durov',
              phone: '+79991234567',
              username: 'pavel',
            },
          };
          break;

        case OPCODES.CONTACT_INFO:
          assert.strictEqual(frame.payload?.userId, 2002n);
          payload = {
            contact: {
              id: 2002n,
              firstName: 'Pavel',
              bio: 'Telegram creator in MAX',
            },
          };
          break;

        case OPCODES.CONTACT_SEARCH:
          assert.strictEqual(frame.payload?.query, 'Pavel');
          payload = {
            contacts: [
              { id: 2002n, firstName: 'Pavel' },
            ],
          };
          break;

        case OPCODES.PUBLIC_SEARCH:
          assert.strictEqual(frame.payload?.query, 'bot');
          payload = {
            results: [
              { id: 3003n, firstName: 'Echo Bot', username: 'echobot' },
            ],
          };
          break;

        case OPCODES.CONTACT_ADD:
          assert.strictEqual(frame.payload?.phone, '+79991234567');
          assert.strictEqual(frame.payload?.firstName, 'Pavel');
          payload = { ok: true };
          break;

        case OPCODES.CONTACT_UPDATE:
          assert.strictEqual(frame.payload?.firstName, 'UpdatedName');
          assert.strictEqual(frame.payload?.description, 'New bio');
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
  }

  const mockAuth = {
    creds: {
      deviceId: 'dev_1',
      sessionToken: 'tok_1',
      userId: '1001',
    },
    keys: {},
  };

  test('sock.getContactByPhone fetches contact profile by phone number', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const contact = await sock.getContactByPhone('79991234567');
    assert.ok(contact);
    assert.strictEqual(contact.id, '2002');
    assert.strictEqual(contact.firstName, 'Pavel');
    assert.strictEqual(contact.name, 'Pavel Durov');
    assert.strictEqual(contact.username, 'pavel');
  });

  test('sock.getUserProfile fetches public profile details', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const profile = await sock.getUserProfile('2002');
    assert.ok(profile);
    assert.strictEqual(profile.id, '2002');
    assert.strictEqual(profile.bio, 'Telegram creator in MAX');
  });

  test('sock.searchContacts and sock.publicSearch return normalized contacts', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    const localList = await sock.searchContacts('Pavel');
    assert.strictEqual(localList.length, 1);
    assert.strictEqual(localList[0].id, '2002');

    const publicList = await sock.publicSearch('bot');
    assert.strictEqual(publicList.length, 1);
    assert.strictEqual(publicList[0].id, '3003');
    assert.strictEqual(publicList[0].username, 'echobot');
  });

  test('sock.addContact and sock.updateProfile execute correctly', async () => {
    const transport = new MockTransport();
    const sock = makeMaxSocket({ auth: mockAuth as any, transport });
    await sock.connect();

    await sock.addContact('+79991234567', { firstName: 'Pavel' });
    const addFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.CONTACT_ADD);
    assert.ok(addFrame);

    await sock.updateProfile({ firstName: 'UpdatedName', bio: 'New bio' });
    const updateFrame = transport.sentFrames.find((f) => f.opcode === OPCODES.CONTACT_UPDATE);
    assert.ok(updateFrame);
    assert.strictEqual(updateFrame.payload?.firstName, 'UpdatedName');
    assert.strictEqual(updateFrame.payload?.description, 'New bio');
  });
});
