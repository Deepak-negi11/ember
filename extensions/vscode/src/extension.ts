// Ember for VS Code-compatible editors (VS Code, Cursor, Windsurf, VSCodium).
//
// Privacy: heartbeats carry sha1(absolute path) as `entity`, the git root's
// basename as `project`, plus language/branch/stack. File contents and raw
// paths never leave the machine.
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { EmberClient, UnauthorizedError, errorMessage } from './api';
import {
  DEFAULT_API_URL,
  configPath,
  normalizeUrl,
  readSharedConfig,
  validateApiKey,
  writeSharedConfig,
} from './config';
import { findGitRoot, readBranch } from './git';
import { languageName } from './languages';
import { HeartbeatQueue, type FlushResult } from './queue';
import { StackCache } from './stack';
import { HeartbeatGate, detectEditor } from './tracker';
import type { Editor, Heartbeat, Today } from './types';

const VERSION = '0.1.1';
const SECRET_KEY = 'ember.apiKey';
const QUEUE_STATE_KEY = 'ember.queue';
const FLUSH_INTERVAL_MS = 30_000;
const TODAY_INTERVAL_MS = 5 * 60_000;
const GIT_CACHE_MS = 60_000;
const DEACTIVATE_FLUSH_MS = 3_000;

interface SyncStatus {
  at: number;
  ok: boolean;
  message: string;
}

class Ember implements vscode.Disposable {
  private readonly editor: Editor;
  private readonly gate = new HeartbeatGate();
  private readonly stacks = new StackCache();
  private readonly gitCache = new Map<string, { at: number; root: string | undefined }>();
  private readonly queue: HeartbeatQueue;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly output: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private timers: NodeJS.Timeout[] = [];

  private today: Today | undefined;
  private lastSync: SyncStatus | undefined;
  private rejectedKey: string | undefined;
  private keyRejected = false;
  private authWarningShown = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.editor = detectEditor(vscode.env.appName, vscode.env.uriScheme);
    this.output = vscode.window.createOutputChannel('Ember');
    this.queue = new HeartbeatQueue(
      {
        get: () => context.globalState.get<Heartbeat[]>(QUEUE_STATE_KEY, []),
        set: (items) => context.globalState.update(QUEUE_STATE_KEY, items),
      },
      { log: (m) => this.log(m) },
    );
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.name = 'Ember';
    this.statusBar.text = '$(flame) Ember';
    this.statusBar.show();
  }

  async start(): Promise<void> {
    const w = vscode.window;
    const ws = vscode.workspace;
    this.disposables.push(
      this.statusBar,
      this.output,
      vscode.commands.registerCommand('ember.setApiKey', () => this.setApiKey()),
      vscode.commands.registerCommand('ember.openDashboard', () => this.openDashboard()),
      vscode.commands.registerCommand('ember.showStatus', () => this.showStatus()),
      ws.onDidChangeTextDocument((e) =>
        this.safe(() => {
          // Only typing in the focused editor counts; background changes (git checkout,
          // formatters in other files, agents) are ignored.
          if (e.contentChanges.length && e.document === w.activeTextEditor?.document) this.onActivity(e.document, false);
        }),
      ),
      // Saving counts too. Opening, switching or scrolling through files does not:
      // only writing code is tracked.
      ws.onDidSaveTextDocument((doc) => this.safe(() => this.onActivity(doc, true))),
      this.context.secrets.onDidChange((e) => this.safe(() => e.key === SECRET_KEY && this.refreshToday())),
      ws.onDidChangeConfiguration((e) => this.safe(() => e.affectsConfiguration('ember.apiUrl') && this.refreshToday())),
    );

    this.timers.push(
      setInterval(() => void this.flush(), FLUSH_INTERVAL_MS),
      setInterval(() => void this.refreshToday(), TODAY_INTERVAL_MS),
    );

    if (!(await this.apiKey())) {
      this.renderStatus();
      // Not awaited: activation must not wait on the user.
      void w
        .showInformationMessage('Ember: set your API key to start tracking coding time.', 'Set API Key')
        .then((pick) => pick && this.setApiKey());
    } else {
      void this.refreshToday();
    }
  }

  // ---- configuration ------------------------------------------------------

  /** User-level `ember.apiUrl` wins; otherwise ~/.ember/config.json; otherwise localhost. */
  private apiUrl(): string {
    const configured = vscode.workspace.getConfiguration('ember').inspect<string>('apiUrl')?.globalValue;
    if (configured?.trim()) return normalizeUrl(configured);
    const shared = readSharedConfig().api_url;
    return normalizeUrl(typeof shared === 'string' && shared.trim() ? shared : DEFAULT_API_URL);
  }

  /** SecretStorage first, then the shared config file. */
  private async apiKey(): Promise<string | undefined> {
    try {
      const secret = await this.context.secrets.get(SECRET_KEY);
      if (secret) return secret;
    } catch (e) {
      this.log(`SecretStorage unavailable: ${errorMessage(e)}`);
    }
    const shared = readSharedConfig().api_key;
    return typeof shared === 'string' && shared ? shared : undefined;
  }

  private client(key: string): EmberClient {
    return new EmberClient(this.apiUrl(), key, `ember-vscode/${VERSION} (${this.editor}; ${vscode.version})`);
  }

  // ---- tracking -----------------------------------------------------------

  /** An edit or a save. Saves always send; edits are throttled per file by the gate. */
  private onActivity(doc: vscode.TextDocument, isSave: boolean): void {
    if (doc.uri.scheme !== 'file' || doc.isUntitled) return; // skips output panels, git:, untitled, etc.
    const file = doc.uri.fsPath;
    const now = Date.now() / 1000;
    if (!this.gate.shouldSend(file, now, isSave)) return;
    this.gate.record(file, now);
    this.queue.enqueue(this.buildHeartbeat(doc, file, now));
  }

  private buildHeartbeat(doc: vscode.TextDocument, file: string, now: number): Heartbeat {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const gitRoot = this.gitRoot(path.dirname(file));
    const project = path.basename(gitRoot ?? folder?.uri.fsPath ?? path.dirname(file));
    const hb: Heartbeat = {
      time: now,
      project,
      editor: this.editor,
      category: 'coding',
      // Every heartbeat comes from writing code; the server only counts these.
      is_write: true,
      entity: crypto.createHash('sha1').update(file).digest('hex'),
    };
    const language = languageName(doc.languageId);
    if (language) hb.language = language;
    if (gitRoot) {
      const branch = readBranch(gitRoot);
      if (branch) hb.branch = branch;
    }
    const stackRoot = folder?.uri.scheme === 'file' ? folder.uri.fsPath : (gitRoot ?? path.dirname(file));
    const stack = this.stacks.get(stackRoot);
    if (stack.length) hb.stack = stack;
    return hb;
  }

  private gitRoot(dir: string): string | undefined {
    const hit = this.gitCache.get(dir);
    if (hit && Date.now() - hit.at < GIT_CACHE_MS) return hit.root;
    const root = findGitRoot(dir);
    this.gitCache.set(dir, { at: Date.now(), root });
    return root;
  }

  // ---- syncing ------------------------------------------------------------

  async flush(force = false): Promise<FlushResult | undefined> {
    try {
      const key = await this.apiKey();
      if (!key) {
        await this.queue.persist();
        return undefined;
      }
      // A different key appeared (e.g. written by the agent-hook installer): try again.
      if (this.queue.authBlocked && key !== this.rejectedKey) {
        this.queue.resetAuth();
        this.authWarningShown = false;
      }
      const client = this.client(key);
      const result = await this.queue.flush((batch) => client.sendHeartbeats(batch), { force });
      if (result.status === 'empty' || result.status === 'skipped') return result;

      if (result.status === 'unauthorized') {
        this.rejectedKey = key;
        this.keyRejected = true;
        this.lastSync = { at: Date.now(), ok: false, message: 'API key rejected (401)' };
        this.warnUnauthorized();
      } else if (result.status === 'retry') {
        this.lastSync = { at: Date.now(), ok: false, message: `${result.error}; ${result.pending} queued, will retry` };
      } else {
        this.keyRejected = false;
        this.lastSync = {
          at: Date.now(),
          ok: true,
          message: `${result.accepted} accepted, ${result.duplicates} duplicates${result.dropped ? `, ${result.dropped} rejected` : ''}`,
        };
        if (result.sent) void this.refreshToday();
      }
      this.renderStatus();
      return result;
    } catch (e) {
      this.log(`flush error: ${errorMessage(e)}`);
      return undefined;
    }
  }

  async refreshToday(): Promise<void> {
    try {
      const key = await this.apiKey();
      if (!key) return this.renderStatus();
      this.today = await this.client(key).today();
      this.keyRejected = false;
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        this.today = undefined;
        this.keyRejected = true;
        this.lastSync = { at: Date.now(), ok: false, message: 'API key rejected (401)' };
      } else {
        this.log(`could not fetch today's total: ${errorMessage(e)}`);
      }
    }
    this.renderStatus();
  }

  private renderStatus(): void {
    void this.apiKey().then((key) => {
      const sb = this.statusBar;
      const unauthorized = this.queue.authBlocked || this.keyRejected;
      if (!key) {
        sb.text = '$(flame) Ember: set key';
        sb.command = 'ember.setApiKey';
      } else {
        sb.text = unauthorized ? '$(flame) Ember: key rejected' : `$(flame) ${this.today?.text || '0m'}`;
        sb.command = unauthorized ? 'ember.setApiKey' : 'ember.openDashboard';
      }
      const lines = [
        `Ember${this.today?.username ? ` (${this.today.username})` : ''}: ${this.today?.text || 'no data yet'} today`,
        this.lastSync
          ? `Last sync ${new Date(this.lastSync.at).toLocaleTimeString()}: ${this.lastSync.ok ? 'OK' : 'failed'} - ${this.lastSync.message}`
          : 'Not synced yet',
        `Queued heartbeats: ${this.queue.pending}`,
        key && !unauthorized ? 'Click to open the dashboard' : 'Click to set your API key',
      ];
      sb.tooltip = lines.join('\n');
    });
  }

  private warnUnauthorized(): void {
    if (this.authWarningShown) return;
    this.authWarningShown = true;
    void vscode.window
      .showWarningMessage(
        'Ember: the server rejected your API key (401). Heartbeats are kept locally until you set a valid key.',
        'Set API Key',
      )
      .then((pick) => pick && this.setApiKey());
  }

  // ---- commands -----------------------------------------------------------

  async setApiKey(): Promise<void> {
    try {
      const current = await this.apiKey();
      const input = await vscode.window.showInputBox({
        title: 'Ember API Key',
        prompt: 'Paste the API key from your Ember dashboard (Settings).',
        placeHolder: 'ember_...',
        password: true,
        ignoreFocusOut: true,
        value: current ?? '',
        validateInput: (v) => validateApiKey(v),
      });
      if (input === undefined) return;
      const key = input.trim();
      await this.context.secrets.store(SECRET_KEY, key);
      // Share with the other collectors (agent hook) while keeping their api_url.
      const shared = readSharedConfig();
      const file = writeSharedConfig({
        api_key: key,
        api_url: typeof shared.api_url === 'string' && shared.api_url ? shared.api_url : this.apiUrl(),
      });
      this.log(`API key saved to SecretStorage and ${file}`);
      this.queue.resetAuth();
      this.rejectedKey = undefined;
      this.keyRejected = false;
      this.authWarningShown = false;
      this.lastSync = undefined;
      vscode.window.showInformationMessage('Ember: API key saved.');
      await this.flush(true);
      await this.refreshToday();
    } catch (e) {
      vscode.window.showErrorMessage(`Ember: could not save the API key: ${errorMessage(e)}`);
    }
  }

  async openDashboard(): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(`${this.apiUrl()}/dashboard`));
  }

  async showStatus(): Promise<void> {
    const key = await this.apiKey();
    const secret = await this.context.secrets.get(SECRET_KEY).then(
      (v) => !!v,
      () => false,
    );
    const retryAt = this.queue.retryAt > Date.now() ? new Date(this.queue.retryAt).toLocaleTimeString() : undefined;
    const details = [
      `Editor: ${this.editor} (${vscode.env.appName})`,
      `Server: ${this.apiUrl()}`,
      `API key: ${key ? `${key.slice(0, 10)}... (from ${secret ? 'SecretStorage' : configPath()})` : 'not set'}`,
      `Today: ${this.today?.text ?? 'unknown'}`,
      `Queued heartbeats: ${this.queue.pending}`,
      `Last sync: ${this.lastSync ? `${new Date(this.lastSync.at).toLocaleString()} - ${this.lastSync.ok ? 'OK' : 'failed'} - ${this.lastSync.message}` : 'never'}`,
      retryAt ? `Next retry: ${retryAt}` : undefined,
      this.queue.authBlocked ? 'Sending paused: API key rejected (401)' : undefined,
    ].filter(Boolean) as string[];
    details.forEach((d) => this.log(d));
    const pick = await vscode.window.showInformationMessage(
      'Ember status',
      { modal: true, detail: details.join('\n') },
      'Sync Now',
      'Open Dashboard',
      'Set API Key',
    );
    if (pick === 'Sync Now') await this.flush(true);
    else if (pick === 'Open Dashboard') await this.openDashboard();
    else if (pick === 'Set API Key') await this.setApiKey();
  }

  // ---- lifecycle / helpers ------------------------------------------------

  /** Event handlers must never throw into the editor. */
  private safe(fn: () => unknown): void {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((e) => this.log(`handler error: ${errorMessage(e)}`));
      }
    } catch (e) {
      this.log(`handler error: ${errorMessage(e)}`);
    }
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  /** Persist first (cannot be lost), then make one bounded attempt to send. */
  async shutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    try {
      await this.queue.persist();
      await Promise.race([this.flush(), new Promise((r) => setTimeout(r, DEACTIVATE_FLUSH_MS))]);
    } catch {
      /* best effort */
    }
  }

  dispose(): void {
    this.timers.forEach(clearInterval);
    this.disposables.forEach((d) => d.dispose());
  }
}

let ember: Ember | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  ember = new Ember(context);
  context.subscriptions.push(ember);
  try {
    await ember.start();
  } catch (e) {
    console.error('[ember] activation error', e);
  }
}

export async function deactivate(): Promise<void> {
  await ember?.shutdown();
  ember = undefined;
}
