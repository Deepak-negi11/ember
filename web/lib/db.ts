import { createClient, type Client, type InArgs, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";

// One client per process. Locally it is a SQLite file (data/ember.db); in
// production set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN and the same SQL runs
// against Turso (hosted SQLite), which survives serverless deploys.
type Conn = { client: Client; ready: Promise<void>; schema: string };
const g = globalThis as unknown as { __ember?: Conn };

function open(): Conn {
  const remote = process.env.TURSO_DATABASE_URL;
  let url: string;
  if (remote) url = remote;
  else {
    if (process.env.VERCEL) throw new Error("TURSO_DATABASE_URL is not set. Serverless hosts cannot keep a local SQLite file.");
    const file = process.env.EMBER_DB ?? path.join(process.cwd(), "data", "ember.db");
    mkdirSync(path.dirname(file), { recursive: true });
    url = `file:${file}`;
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const ready = (async () => {
    if (!remote) await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA foreign_keys = ON");
    await migrate(client);
  })();
  return { client, ready, schema: SCHEMA };
}

async function conn(): Promise<Client> {
  g.__ember ??= open();
  // The client outlives hot reloads in `next dev`; migrate again when the code's schema changed.
  if (g.__ember.schema !== SCHEMA) {
    const { client } = g.__ember;
    g.__ember = { client, ready: g.__ember.ready.then(() => migrate(client)), schema: SCHEMA };
  }
  try {
    await g.__ember.ready;
  } catch (err) {
    g.__ember = undefined; // let the next request retry instead of caching the failure
    throw err;
  }
  return g.__ember.client;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  quote         TEXT NOT NULL DEFAULT '',
  twitter       TEXT NOT NULL DEFAULT '',
  github        TEXT NOT NULL DEFAULT '',
  website       TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  hide_projects INTEGER NOT NULL DEFAULT 0 CHECK (hide_projects IN (0, 1)),
  created_at    INTEGER NOT NULL
);

-- Sign-in identities. Accounts are created only through X or Google.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider         TEXT NOT NULL CHECK (provider IN ('x', 'google', 'github')),
  provider_user_id TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle           TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Only a SHA-256 of each key is stored; the plaintext is shown once on creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);

-- Raw activity. The UNIQUE constraint makes client retries idempotent.
CREATE TABLE IF NOT EXISTS heartbeats (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time       INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  project    TEXT NOT NULL,
  language   TEXT NOT NULL,
  branch     TEXT NOT NULL DEFAULT '',
  editor     TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('coding', 'ai')),
  is_write   INTEGER NOT NULL DEFAULT 0,
  entity     TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, time, editor, project, entity)
);
CREATE INDEX IF NOT EXISTS heartbeats_user_day ON heartbeats(user_id, local_date, time);
-- For the rolling 24-hour leaderboard, which reads recent heartbeats across all users.
CREATE INDEX IF NOT EXISTS heartbeats_time ON heartbeats(time);

CREATE TABLE IF NOT EXISTS projects (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  stack      TEXT NOT NULL DEFAULT '[]',
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (user_id, name)
);

-- Rollups, always fully derived from heartbeats (see lib/stats.ts recomputeDay).
CREATE TABLE IF NOT EXISTS daily_stats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  ai_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS daily_stats_date ON daily_stats(date);

-- Seconds per local hour of day, for the community "when people code" chart.
CREATE TABLE IF NOT EXISTS daily_hours (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  hour    INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, date, hour)
);
CREATE INDEX IF NOT EXISTS daily_hours_date ON daily_hours(date);

CREATE TABLE IF NOT EXISTS daily_breakdown (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('project', 'language', 'editor')),
  name    TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  -- Part of seconds credited to AI agents; lets leaderboards rank hands-on time per language.
  ai_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, kind, name)
);
-- Leaderboard language filters read one kind over a date window across all users;
-- without this they scan the whole table on every page view.
CREATE INDEX IF NOT EXISTS daily_breakdown_kind_date ON daily_breakdown(kind, date);

-- Raw token usage from AI agents (model + four counts, never content). The hook
-- gives each record an opaque id, so retried sends are ignored.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  time        INTEGER NOT NULL,
  local_date  TEXT NOT NULL,
  agent       TEXT NOT NULL,
  model       TEXT NOT NULL,
  input       INTEGER NOT NULL,
  output      INTEGER NOT NULL,
  cache_read  INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS ai_usage_user_day ON ai_usage(user_id, local_date);
-- Each person's latest record, for the agent they are using now.
CREATE INDEX IF NOT EXISTS ai_usage_user_time ON ai_usage(user_id, time);

-- Rollup of ai_usage per day, agent and model, with the estimated cost at list
-- prices (lib/usage.ts). Rebuilt from ai_usage by recomputeAiDay.
CREATE TABLE IF NOT EXISTS daily_ai_usage (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  agent       TEXT NOT NULL,
  model       TEXT NOT NULL,
  input       INTEGER NOT NULL,
  output      INTEGER NOT NULL,
  cache_read  INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL,
  PRIMARY KEY (user_id, date, agent, model)
);
CREATE INDEX IF NOT EXISTS daily_ai_usage_date ON daily_ai_usage(date);
`;

async function columns(c: Client | Transaction, table: string): Promise<string[]> {
  return (await c.execute({ sql: "SELECT name FROM pragma_table_info(?)", args: [table] })).rows.map((r) => String(r.name));
}

/**
 * Schema upgrades are detected from the shape of the tables, so they work the
 * same on a local file and on Turso.
 *  v1 -> v2: users lose email/password columns and gain avatar_url.
 *  v2 -> v3: oauth_accounts also accepts the 'github' provider.
 *  v3 -> v4: daily_breakdown gains ai_seconds (0 until `npm run backfill`).
 * SQLite cannot drop columns or change CHECK constraints in place, so affected
 * tables are rebuilt and their rows copied. Added columns use ALTER TABLE.
 */
async function migrate(c: Client) {
  const userCols = await columns(c, "users");
  if (userCols.length && userCols.includes("password_hash")) {
    await c.executeMultiple(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE users_v2 (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT COLLATE NOCASE,
        display_name TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL DEFAULT '', twitter TEXT NOT NULL DEFAULT '', github TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT 'UTC',
        hide_projects INTEGER NOT NULL DEFAULT 0 CHECK (hide_projects IN (0, 1)), created_at INTEGER NOT NULL
      );
      INSERT INTO users_v2 (id, username, email, display_name, bio, quote, twitter, github, website, location, timezone, hide_projects, created_at)
        SELECT id, username, email, display_name, bio, quote, twitter, github, website, location, timezone, hide_projects, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
  const oauthSql = (await c.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'oauth_accounts'")).rows[0]?.sql;
  if (typeof oauthSql === "string" && !oauthSql.includes("'github'")) {
    await c.executeMultiple(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE oauth_accounts_v3 (
        provider TEXT NOT NULL CHECK (provider IN ('x', 'google', 'github')), provider_user_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, handle TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, PRIMARY KEY (provider, provider_user_id), UNIQUE (user_id, provider)
      );
      INSERT INTO oauth_accounts_v3 SELECT provider, provider_user_id, user_id, handle, created_at FROM oauth_accounts;
      DROP TABLE oauth_accounts;
      ALTER TABLE oauth_accounts_v3 RENAME TO oauth_accounts;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
  await c.executeMultiple(SCHEMA);
  if (!(await columns(c, "daily_breakdown")).includes("ai_seconds")) {
    await c.execute("ALTER TABLE daily_breakdown ADD COLUMN ai_seconds INTEGER NOT NULL DEFAULT 0");
  }
}

// ---- Query helpers -------------------------------------------------------------

export type Param = string | number | bigint | null | Uint8Array | boolean;

/** Anything that can run SQL: the shared client or an open transaction. */
export interface Q {
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
  get<T>(sql: string, ...params: Param[]): Promise<T | null>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

function wrap(exec: (sql: string, args: InArgs) => ReturnType<Client["execute"]>): Q {
  return {
    async all<T>(sql: string, ...params: Param[]) {
      return (await exec(sql, params)).rows.map((r) => ({ ...r }) as T);
    },
    async get<T>(sql: string, ...params: Param[]) {
      const r = (await exec(sql, params)).rows[0];
      return r ? ({ ...r } as T) : null;
    },
    async run(sql: string, ...params: Param[]) {
      const r = await exec(sql, params);
      return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
  };
}

const shared = wrap(async (sql, args) => (await conn()).execute({ sql, args }));

/** SELECT many rows as plain objects. */
export const all = shared.all;
/** SELECT one row, or null. */
export const get = shared.get;
/** INSERT / UPDATE / DELETE. */
export const run = shared.run;

/** Run fn in a write transaction; commits on success, rolls back on throw. */
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const t = await (await conn()).transaction("write");
  try {
    const out = await fn(wrap((sql, args) => t.execute({ sql, args })));
    await t.commit();
    return out;
  } catch (err) {
    await t.rollback().catch(() => {});
    throw err;
  } finally {
    t.close();
  }
}

/** Close the shared client (tests and scripts). */
export async function closeDb() {
  const cur = g.__ember;
  g.__ember = undefined;
  if (!cur) return;
  await cur.ready.catch(() => undefined);
  cur.client.close();
}
