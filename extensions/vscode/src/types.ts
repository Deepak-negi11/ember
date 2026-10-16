// Wire types shared with the Ember server (see API contract).

export type Editor = 'vscode' | 'cursor' | 'windsurf' | 'vscodium';

export interface Heartbeat {
  /** Unix seconds (float allowed). */
  time: number;
  project: string;
  /** Human-readable language name, e.g. "TypeScript". */
  language?: string;
  branch?: string;
  editor: Editor | 'claude-code' | 'codex';
  category: 'coding' | 'ai';
  is_write?: boolean;
  stack?: string[];
  /** sha1 hex of the absolute file path. Never the raw path. */
  entity?: string;
}

export type SendResult =
  | { kind: 'ok'; accepted: number; duplicates: number }
  | { kind: 'invalid'; status: number; message: string } // 400: drop, never retry
  | { kind: 'unauthorized' } // 401: stop until the key changes
  | { kind: 'retry'; status: number; message: string }; // 429 / 5xx / network

export interface Today {
  seconds: number;
  text: string;
  username: string;
}
