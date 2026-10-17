// File identity sent as a heartbeat's `entity`, shared with the agent hook.
//
// A plain hash of a path can be reversed by guessing likely paths, so the path
// is HMAC'd with a random per-machine key kept in ~/.ember/entity.key (mode 0600).
// The server only uses `entity` to de-duplicate retries.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { emberDir } from './config';

const KEY_RE = /^[a-f0-9]{64}$/;

/** HMAC-SHA256 of the absolute path, cut to the 40 hex characters the server accepts. */
export function entityHash(key: string, file: string): string {
  return crypto.createHmac('sha256', key).update(file).digest('hex').slice(0, 40);
}

function readKey(file: string): string | undefined {
  try {
    const key = fs.readFileSync(file, 'utf8').trim();
    return KEY_RE.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the shared key, creating it on first use. Concurrent first runs (this
 * extension in two windows, the agent hook) agree on one key: the first hard
 * link wins. Throws if the key can't be stored; the caller decides the fallback.
 */
export function loadEntityKey(dir = emberDir()): string {
  const file = path.join(dir, 'entity.key');
  const existing = readKey(file);
  if (existing) return existing;
  const key = crypto.randomBytes(32).toString('hex');
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
    try {
      fs.linkSync(tmp, file);
      return key;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const winner = readKey(file);
      if (winner) return winner;
      fs.renameSync(tmp, file); // existing file is corrupt: replace it
      return key;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
