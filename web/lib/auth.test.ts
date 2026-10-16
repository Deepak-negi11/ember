import { after, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A v1 database (email/password era) on disk, migrated by opening it.
const file = path.join(mkdtempSync(path.join(tmpdir(), "ember-mig-")), "v1.db");
{
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '',
      twitter TEXT NOT NULL DEFAULT '', github TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'UTC', hide_projects INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE daily_stats (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, seconds INTEGER NOT NULL,
      ai_seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, date));
    INSERT INTO users (username, email, password_hash, display_name, quote, created_at) VALUES ('old-timer', 'o@x.dev', 'scrypt$a$b', 'Old Timer', 'keep me', 1);
    INSERT INTO daily_stats VALUES (1, '2026-10-01', 3600, 0);
  `);
  old.close();
}
process.env.EMBER_DB = file;
const { all, closeDb, get } = await import("./db.ts");
after(closeDb);
const { signInWithProfile, linkProfile, linkedAccounts } = await import("./accounts.ts");

test("old databases migrate: users keep data, passwords go, github is allowed", async () => {
  const cols = (await all<{ name: string }>("SELECT name FROM pragma_table_info('users')")).map((c) => c.name);
  assert.ok(!cols.includes("password_hash"));
  assert.ok(cols.includes("avatar_url"));
  assert.deepEqual(await get("SELECT username, quote FROM users WHERE id = 1"), { username: "old-timer", quote: "keep me" });
  assert.equal((await get<{ s: number }>("SELECT seconds AS s FROM daily_stats WHERE user_id = 1"))!.s, 3600);
  const oauth = await get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'oauth_accounts'");
  assert.ok(oauth!.sql.includes("'github'"));
});

const xProfile = { provider: "x" as const, id: "123", name: "Deepak Negi", handle: "deepak_dev", email: null, avatar: "https://pbs.twimg.com/a_400x400.jpg", bio: "Rust", location: "Dehradun" };

test("first X sign-in creates a user with a verified handle", async () => {
  const r = await signInWithProfile(xProfile, "Asia/Kolkata");
  assert.equal(r.created, true);
  const u = (await get<{ username: string; twitter: string; timezone: string; avatar_url: string }>("SELECT username, twitter, timezone, avatar_url FROM users WHERE id = ?", r.userId))!;
  assert.deepEqual(u, { username: "deepak_dev".replace("_", "-"), twitter: "deepak_dev", timezone: "Asia/Kolkata", avatar_url: xProfile.avatar });
});

test("second sign-in reuses the account and refreshes the handle", async () => {
  const r = await signInWithProfile({ ...xProfile, handle: "deepak_new" }, "UTC");
  assert.equal(r.created, false);
  assert.equal((await get<{ t: string }>("SELECT twitter AS t FROM users WHERE id = ?", r.userId))!.t, "deepak_new");
});

test("Google never merges into an X account by email; linking is explicit", async () => {
  const g = { provider: "google" as const, id: "g-9", name: "Deepak", handle: "", email: "o@x.dev", avatar: "", bio: "", location: "" };
  const fresh = await signInWithProfile(g, "UTC");
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.userId, 1);
  // The same Google identity cannot be linked to someone else.
  const xUser = (await signInWithProfile(xProfile, "UTC")).userId;
  assert.equal(await linkProfile(xUser, g), "taken");
  assert.deepEqual((await linkedAccounts(xUser)).map((a) => a.provider), ["x"]);
});

test("usernames stay unique and avoid reserved words", async () => {
  const a = await signInWithProfile({ ...xProfile, id: "555", handle: "settings" }, "UTC");
  const name = (await get<{ u: string }>("SELECT username AS u FROM users WHERE id = ?", a.userId))!.u;
  assert.equal(name, "settings-2");
});

test("GitHub sign-in sets the verified GitHub username and pre-fills the declared X handle", async () => {
  const gh = { provider: "github" as const, id: "4242", name: "Asha Verma", handle: "asha-codes", email: null, avatar: "https://avatars.githubusercontent.com/u/4242", bio: "Rust", location: "Pune", declaredTwitter: "asha_x" };
  const r = await signInWithProfile(gh, "Asia/Kolkata");
  assert.equal(r.created, true);
  const u = (await get<{ username: string; github: string; twitter: string }>("SELECT username, github, twitter FROM users WHERE id = ?", r.userId))!;
  assert.deepEqual(u, { username: "asha-codes", github: "asha-codes", twitter: "asha_x" });
});
