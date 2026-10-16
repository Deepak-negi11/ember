import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { get, run, tx } from "./db.ts";

export const SESSION_COOKIE = "ember_session";
const SESSION_TTL_SEC = 30 * 24 * 3600;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const nowSec = () => Math.floor(Date.now() / 1000);

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  await run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(token), userId, nowSec() + SESSION_TTL_SEC);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  jar.delete(SESSION_COOKIE);
}

export interface User {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  avatar_url: string;
  bio: string;
  quote: string;
  twitter: string;
  github: string;
  website: string;
  location: string;
  timezone: string;
  hide_projects: number;
  created_at: number;
}

const USER_COLS = "id, username, email, display_name, avatar_url, bio, quote, twitter, github, website, location, timezone, hide_projects, created_at";

/** The signed-in user. Cached per request, so layouts and pages share one lookup. */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return get<User>(
    `SELECT ${USER_COLS.split(", ").map((c) => "u." + c).join(", ")}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token), nowSec(),
  );
});

export function userByUsername(username: string): Promise<User | null> {
  return get<User>(`SELECT ${USER_COLS} FROM users WHERE username = ?`, username);
}

// ---- API keys -------------------------------------------------------------

export async function generateApiKey(userId: number): Promise<string> {
  const key = "ember_" + randomBytes(20).toString("hex");
  // One active key per user: regenerating revokes the previous one.
  await tx(async (q) => {
    await q.run("DELETE FROM api_keys WHERE user_id = ?", userId);
    await q.run("INSERT INTO api_keys (user_id, key_hash, hint, created_at) VALUES (?, ?, ?, ?)", userId, sha256(key), key.slice(-4), nowSec());
  });
  return key;
}

export function apiKeyInfo(userId: number): Promise<{ hint: string; created_at: number; last_used_at: number | null } | null> {
  return get("SELECT hint, created_at, last_used_at FROM api_keys WHERE user_id = ?", userId);
}

/** Resolve a Bearer token to a user, or null. */
export async function userFromApiKey(header: string | null): Promise<{ id: number; timezone: string } | null> {
  const m = header?.match(/^Bearer\s+(ember_[a-f0-9]{40})$/);
  if (!m) return null;
  const hash = sha256(m[1]);
  const row = await get<{ id: number; timezone: string }>(
    "SELECT u.id, u.timezone FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?",
    hash,
  );
  if (!row) return null;
  // Only write when stale: every heartbeat flush would otherwise cost a write.
  const now = nowSec();
  await run("UPDATE api_keys SET last_used_at = ? WHERE key_hash = ? AND (last_used_at IS NULL OR last_used_at < ?)", now, hash, now - 300);
  return row;
}

// ---- Simple in-memory rate limiter (per process) ----------------------------

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowSec: number): boolean {
  const now = nowSec();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowSec });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    return true;
  }
  b.count++;
  return b.count <= limit;
}
