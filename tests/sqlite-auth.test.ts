import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { useSqliteAuthState } from '../src/session/sqlite-auth.js';

describe('useSqliteAuthState', () => {
  const tempDbPath = path.join(os.tmpdir(), `test-session-${Date.now()}-${Math.random().toString(36).substring(2)}.db`);

  afterEach(async () => {
    try {
      await fs.unlink(tempDbPath);
    } catch {}
  });

  test('creates new sqlite database and initializes default credentials', async () => {
    const { state, saveCreds, close } = await useSqliteAuthState(tempDbPath);

    assert.ok(state.creds, 'creds should exist');
    assert.ok(state.creds.deviceId, 'deviceId should be generated');
    assert.equal(state.creds.phone, undefined);
    assert.equal(state.creds.sessionToken, undefined);

    close();
  });

  test('persists credentials and keys across reloads', async () => {
    // 1. Initial write
    const session1 = await useSqliteAuthState(tempDbPath);
    session1.state.creds.phone = '+79991234567';
    session1.state.creds.sessionToken = 'token_abc_123';
    session1.state.creds.userId = 'user_777';
    session1.state.keys['custom_key'] = { foo: 'bar', count: 42 };

    await session1.saveCreds();
    session1.close();

    // 2. Reload from same db file
    const session2 = await useSqliteAuthState(tempDbPath);
    assert.equal(session2.state.creds.phone, '+79991234567');
    assert.equal(session2.state.creds.sessionToken, 'token_abc_123');
    assert.equal(session2.state.creds.userId, 'user_777');
    assert.deepEqual(session2.state.keys['custom_key'], { foo: 'bar', count: 42 });

    // 3. Update existing credentials
    session2.state.creds.sessionToken = 'token_xyz_999';
    await session2.saveCreds();
    session2.close();

    // 4. Verify update
    const session3 = await useSqliteAuthState(tempDbPath);
    assert.equal(session3.state.creds.sessionToken, 'token_xyz_999');
    session3.close();
  });

  test('creates parent directories if not present', async () => {
    const nestedDir = path.join(os.tmpdir(), `nested-${Date.now()}`, 'sessions');
    const nestedDbPath = path.join(nestedDir, 'session.db');

    const session = await useSqliteAuthState(nestedDbPath);
    session.state.creds.phone = '+79000000000';
    await session.saveCreds();
    session.close();

    const stat = await fs.stat(nestedDbPath);
    assert.ok(stat.isFile(), 'db file should exist in nested directory');

    // Clean up
    await fs.rm(path.dirname(nestedDir), { recursive: true, force: true });
  });
});
