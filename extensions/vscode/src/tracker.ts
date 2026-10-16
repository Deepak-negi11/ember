// Editor detection and the WakaTime-style "should we send a heartbeat?" rule.
import type { Editor } from './types';

/** Identify the host editor from vscode.env.appName / uriScheme. */
export function detectEditor(appName: string | undefined, uriScheme: string | undefined): Editor {
  const s = `${appName ?? ''} ${uriScheme ?? ''}`.toLowerCase();
  if (s.includes('cursor')) return 'cursor';
  if (s.includes('windsurf')) return 'windsurf';
  if (s.includes('codium')) return 'vscodium';
  return 'vscode';
}

/** Minimum gap between heartbeats for the same file without a save or file switch. */
export const SAME_FILE_INTERVAL_S = 120;

/**
 * Send when the file differs from the last heartbeat's file, when at least
 * 120s passed since the last heartbeat for the same file, or on save.
 */
export class HeartbeatGate {
  private lastFile: string | undefined;
  private lastTime = 0;

  shouldSend(file: string, nowSeconds: number, isWrite: boolean): boolean {
    if (isWrite) return true;
    if (file !== this.lastFile) return true;
    return nowSeconds - this.lastTime >= SAME_FILE_INTERVAL_S;
  }

  record(file: string, nowSeconds: number): void {
    this.lastFile = file;
    this.lastTime = nowSeconds;
  }
}
