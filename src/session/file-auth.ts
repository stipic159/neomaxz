import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initAuthenticationCreds, type AuthenticationCreds, type AuthenticationState } from './auth-state.js';

export async function useMultiFileAuthState(folder: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  await fs.mkdir(folder, { recursive: true });
  const credsFile = path.join(folder, 'creds.json');
  const keysFile = path.join(folder, 'keys.json');

  let creds: AuthenticationCreds;
  try {
    const raw = await fs.readFile(credsFile, 'utf-8');
    creds = JSON.parse(raw);
    if (!creds.deviceId) {
      creds.deviceId = initAuthenticationCreds().deviceId;
    }
  } catch {
    creds = initAuthenticationCreds();
  }

  let keys: Record<string, any> = {};
  try {
    const rawKeys = await fs.readFile(keysFile, 'utf-8');
    keys = JSON.parse(rawKeys);
  } catch {
    keys = {};
  }

  const state: AuthenticationState = {
    creds,
    keys,
  };

  // Promise queue for strictly sequential disk writes on Windows
  let writeQueue = Promise.resolve();

  const safeWriteAtomic = async (targetFile: string, content: string): Promise<void> => {
    const tmpFile = `${targetFile}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmpFile, content, 'utf-8');
      await fs.rename(tmpFile, targetFile);
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {});
      throw err;
    }
  };

  const saveCreds = async (): Promise<void> => {
    const runSave = async () => {
      const credsContent = JSON.stringify(state.creds, null, 2);
      await safeWriteAtomic(credsFile, credsContent);

      if (state.keys && Object.keys(state.keys).length > 0) {
        const keysContent = JSON.stringify(state.keys, null, 2);
        await safeWriteAtomic(keysFile, keysContent);
      }
    };

    // Chain onto queue to guarantee serial execution
    writeQueue = writeQueue.then(runSave, runSave);
    return writeQueue;
  };

  return {
    state,
    saveCreds,
  };
}
