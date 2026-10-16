// Shared ~/.ember/config.json, read by every Ember collector and written by
// this extension when the user sets a key.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const DEFAULT_API_URL = 'http://localhost:3000';
export const API_KEY_RE = /^ember_[0-9a-f]{40}$/i;

export interface SharedConfig {
  api_key?: string;
  api_url?: string;
  [extra: string]: unknown;
}

export function emberDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMBER_HOME || path.join(os.homedir(), '.ember');
}

export function configPath(dir = emberDir()): string {
  return path.join(dir, 'config.json');
}

export function readSharedConfig(dir = emberDir()): SharedConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into config.json (other fields preserved), written atomically with mode 0600. */
export function writeSharedConfig(patch: SharedConfig, dir = emberDir()): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configPath(dir);
  const next = { ...readSharedConfig(dir), ...patch };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // mode is ignored if tmp already existed
  fs.renameSync(tmp, file);
  return file;
}

/** Explain what is wrong with a key, or return undefined when it looks valid. */
export function validateApiKey(key: string): string | undefined {
  const k = key.trim();
  if (!k.startsWith('ember_')) return 'Ember API keys start with "ember_".';
  if (!API_KEY_RE.test(k)) return 'Expected "ember_" followed by 40 hex characters.';
  return undefined;
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
