import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  initAuthenticationCreds,
  type AuthenticationCreds,
  type AuthenticationState,
} from './auth-state.js';

export interface SqliteAuthStateResult {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  close: () => void;
}

/**
 * Single-file SQLite session storage using Node.js native `node:sqlite` .
 * Saves authentication credentials and keys atomically into a single `session.db` file.
 */
// noinspection SqlNoDataSourceInspection,SqlResolve
export async function useSqliteAuthState(dbPath = 'session.db'): Promise<SqliteAuthStateResult> {
  // Ensure target folder exists if path contains subdirectories
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && dir !== '') {
    await fs.mkdir(dir, { recursive: true });
  }

  const sqliteModule = 'node:sqlite';
  const { DatabaseSync } = await (import(sqliteModule) as Promise<typeof import('node:sqlite')>);
  const db: DatabaseSyncType = new DatabaseSync(dbPath);

  // Initialize SQLite tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS creds (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Load existing credentials
  const getCredStmt = db.prepare('SELECT value FROM creds WHERE key = ?');
  const credRow = getCredStmt.get('creds') as { value: string } | undefined;

  let creds: AuthenticationCreds;
  if (credRow?.value) {
    try {
      creds = JSON.parse(credRow.value);
      if (!creds.deviceId) {
        creds.deviceId = initAuthenticationCreds().deviceId;
      }
    } catch {
      creds = initAuthenticationCreds();
    }
  } else {
    creds = initAuthenticationCreds();
  }

  // Load existing keys
  const getAllKeysStmt = db.prepare('SELECT key, value FROM keys');
  const keyRows = getAllKeysStmt.all() as Array<{ key: string; value: string }>;
  const keys: Record<string, any> = {};
  for (const kRow of keyRows) {
    try {
      keys[kRow.key] = JSON.parse(kRow.value);
    } catch {
      keys[kRow.key] = kRow.value;
    }
  }

  const state: AuthenticationState = {
    creds,
    keys,
  };

  const upsertCredStmt = db.prepare(`
    INSERT INTO creds (key, value) VALUES ('creds', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const upsertKeyStmt = db.prepare(`
    INSERT INTO keys (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const saveCreds = async (): Promise<void> => {
    db.exec('BEGIN TRANSACTION');
    try {
      upsertCredStmt.run(JSON.stringify(state.creds));

      if (state.keys && Object.keys(state.keys).length > 0) {
        for (const [k, v] of Object.entries(state.keys)) {
          upsertKeyStmt.run(k, JSON.stringify(v));
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  };

  const close = (): void => {
    try {
      db.close();
    } catch {}
  };

  return {
    state,
    saveCreds,
    close,
  };
}
