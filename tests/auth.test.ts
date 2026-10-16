import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { useMultiFileAuthState } from '../src/session/file-auth.js';
import {
  findAuthToken,
  findLongToken,
  extractPasswordChallenge,
  looksLikeToken,
  SESSION_TOKEN_LENGTH,
} from '../src/session/tokens.js';
import { AuthManager } from '../src/session/auth-manager.js';
import { Command, OPCODES } from '../src/protocol/opcodes.js';
import type { InboundFrame, OutboundFrame } from '../src/protocol/frame.js';
import type { ITransport } from '../src/socket/transport.js';
import { SocketClient } from '../src/socket/socket-client.js';

describe('Stage 3: Auth & Session Management Tests', () => {
  const tempDir = path.join(os.tmpdir(), `max-test-auth-${Date.now()}`);

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('useMultiFileAuthState initializes, saves, and reloads credentials', async () => {
    const { state, saveCreds } = await useMultiFileAuthState(tempDir);

    assert.ok(state.creds.deviceId, 'deviceId must be generated automatically');
    assert.strictEqual(state.creds.sessionToken, undefined);

    state.creds.phone = '+79998887766';
    state.creds.sessionToken = 'test_token_12345';
    await saveCreds();

    // Reload from the same folder
    const reloaded = await useMultiFileAuthState(tempDir);
    assert.strictEqual(reloaded.state.creds.phone, '+79998887766');
    assert.strictEqual(reloaded.state.creds.sessionToken, 'test_token_12345');
    assert.strictEqual(reloaded.state.creds.deviceId, state.creds.deviceId);
  });

  test('useMultiFileAuthState handles rapid concurrent saveCreds calls without Windows EBUSY race and persists keys', async () => {
    const { state, saveCreds } = await useMultiFileAuthState(tempDir);

    state.creds.phone = '+79991112233';
    state.creds.sessionToken = 'concurrent_test_token';
    state.keys!['pre-key-1'] = { id: 1, key: 'mock_key_buffer_data' };

    // Fire 25 concurrent save operations simultaneously
    const writes = Array.from({ length: 25 }, (_, i) => {
      state.creds.registeredAt = i;
      return saveCreds();
    });

    // None of the concurrent saves should throw EBUSY or collide
    await Promise.all(writes);

    // Reload from disk and verify both creds and keys were persisted
    const reloaded = await useMultiFileAuthState(tempDir);
    assert.strictEqual(reloaded.state.creds.phone, '+79991112233');
    assert.strictEqual(reloaded.state.creds.sessionToken, 'concurrent_test_token');
    assert.deepStrictEqual(reloaded.state.keys!['pre-key-1'], { id: 1, key: 'mock_key_buffer_data' });
  });

  test('Token extraction utilities work dynamically with arbitrary token lengths and schema locations', () => {
    assert.strictEqual(findAuthToken({ token: 'quick_auth_token_xyz' }), 'quick_auth_token_xyz');
    assert.strictEqual(findAuthToken({ not_token: 123 }), undefined);

    // Support tokens of arbitrary valid lengths (not just 663!)
    const token128 = 'T128_'.repeat(25) + 'abcd'; // 129 chars
    const token512 = 'B'.repeat(512);
    const token1024 = 'C'.repeat(1024);
    const legacy663 = 'A'.repeat(SESSION_TOKEN_LENGTH);

    assert.strictEqual(looksLikeToken(token128), true);
    assert.strictEqual(looksLikeToken(token512), true);
    assert.strictEqual(looksLikeToken(token1024), true);
    assert.strictEqual(looksLikeToken(legacy663), true);

    // Too short (< 32 chars) or invalid alphabet must be rejected
    assert.strictEqual(looksLikeToken('too_short_tok'), false);
    assert.strictEqual(looksLikeToken('with spaces in the middle ' + 'x'.repeat(40)), false);
    assert.strictEqual(looksLikeToken('русский_текст_в_токене_' + 'x'.repeat(40)), false);

    // Test direct extraction from schema properties
    assert.strictEqual(findLongToken({ tokenAttrs: { LOGIN: { token: token128 } } }), token128);
    assert.strictEqual(findLongToken({ loginToken: token512 }), token512);
    assert.strictEqual(findLongToken({ sessionToken: token1024 }), token1024);

    // Test recursive extraction with arbitrary token length
    const nestedPayload = {
      profile: { id: 1, name: 'Alice' },
      chats: [{ id: 10, text: 'Hello' }],
      data: {
        nested: {
          sessionToken: token512,
        },
      },
    };
    assert.strictEqual(findLongToken(nestedPayload), token512);

    const challengePayload = {
      passwordChallenge: {
        trackId: 'track_id_999',
        hint: 'favorite pet',
      },
    };

    const challenge = extractPasswordChallenge(challengePayload);
    assert.deepStrictEqual(challenge, {
      trackId: 'track_id_999',
      hint: 'favorite pet',
    });
  });

  test('AuthManager workflow: init -> requestAuthCode -> submitAuthCode -> 2FA -> login', async () => {
    class MockAuthTransport implements ITransport {
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
        let responsePayload: Record<string, any> = {};

        switch (frame.opcode) {
          case OPCODES.INIT:
            responsePayload = { ok: true, serverTime: 1720000000 };
            break;

          case OPCODES.START_AUTH:
            assert.strictEqual(frame.payload?.phone, '+79991234567');
            responsePayload = { token: 'auth_sms_token_abc' };
            break;

          case OPCODES.CHECK_CODE:
            assert.strictEqual(frame.payload?.verifyCode, '123456');
            // Simulate 2FA required
            responsePayload = {
              passwordChallenge: {
                trackId: 'track_456',
                hint: 'mother maiden name',
              },
            };
            break;

          case OPCODES.CHECK_PASSWORD:
            assert.strictEqual(frame.payload?.trackId, 'track_456');
            assert.strictEqual(frame.payload?.password, 'secret123');
            responsePayload = {
              token: 'B'.repeat(SESSION_TOKEN_LENGTH),
            };
            break;

          case OPCODES.LOGIN:
            assert.strictEqual(frame.payload?.token, 'B'.repeat(SESSION_TOKEN_LENGTH));
            responsePayload = {
              profile: { id: 777, firstName: 'Bob' },
              chats: [{ id: 101, title: 'Main Chat' }],
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
              payload: responsePayload,
            });
          }
        }, 5);
      }
    }

    const { state } = await useMultiFileAuthState(tempDir);
    const mock = new MockAuthTransport();
    const client = new SocketClient({ transport: mock, autoReconnect: false });
    const auth = new AuthManager(state);

    await client.connect();

    // 1. INIT
    const initRes = await auth.initSession(client);
    assert.strictEqual(initRes.ok, true);

    // 2. Request SMS code
    const { authToken } = await auth.requestAuthCode(client, '79991234567');
    assert.strictEqual(authToken, 'auth_sms_token_abc');
    assert.strictEqual(state.creds.phone, '+79991234567');

    // 3. Submit SMS code -> returns password challenge
    const codeRes = await auth.submitAuthCode(client, '123456');
    assert.strictEqual(codeRes.status, 'password_required');
    if (codeRes.status === 'password_required') {
      assert.strictEqual(codeRes.trackId, 'track_456');
      assert.strictEqual(codeRes.hint, 'mother maiden name');
    }

    // 4. Submit 2FA password
    const loginToken = await auth.submitPassword(client, 'secret123');
    assert.strictEqual(loginToken.length, SESSION_TOKEN_LENGTH);
    assert.strictEqual(state.creds.sessionToken, loginToken);

    // 5. LOGIN
    const loginRes = await auth.loginWithToken(client);
    assert.strictEqual(loginRes.profile.firstName, 'Bob');
    assert.strictEqual(loginRes.chats.length, 1);
    assert.strictEqual(state.creds.userId, '777');
    assert.strictEqual(state.creds.name, 'Bob');

    client.disconnect();
  });
});
