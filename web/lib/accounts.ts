import { all, tx, type Q } from "./db.ts";
import { forgetTimeZones } from "./stats.ts";

const nowSec = () => Math.floor(Date.now() / 1000);

// Sign-in identities (GitHub, Google, X) and the users they belong to. No
// Next.js imports here, so this module is testable with plain node --test.

export type Provider = "github" | "google" | "x";

/** A normalised profile from any provider. */
export interface OAuthProfile {
  provider: Provider;
  id: string;
  name: string;
  handle: string; // GitHub login or X username; "" for Google
  email: string | null; // only set when the provider says it is verified
  avatar: string;
  bio: string;
  location: string;
  /** X handle the person listed on their GitHub profile (self-declared, not verified). */
  declaredTwitter?: string;
}

export function linkedAccounts(userId: number): Promise<{ provider: Provider; handle: string }[]> {
  return all<{ provider: Provider; handle: string }>("SELECT provider, handle FROM oauth_accounts WHERE user_id = ?", userId);
}

const RESERVED = new Set(["admin", "api", "dashboard", "settings", "leaderboard", "login", "signup", "u", "ember", "downloads"]);

async function uniqueUsername(q: Q, base: string): Promise<string> {
  let clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
  if (clean.length < 3) clean = `dev-${clean}`.replace(/-+$/, "") || "dev";
  let candidate = clean;
  for (let i = 2; RESERVED.has(candidate) || (await q.get("SELECT 1 AS x FROM users WHERE username = ?", candidate)); i++) {
    candidate = `${clean}-${i}`;
  }
  return candidate;
}

/** Copy the verified handle into the matching profile field. */
async function applyVerifiedHandle(q: Q, userId: number, p: OAuthProfile) {
  if (!p.handle) return;
  if (p.provider === "x") await q.run("UPDATE users SET twitter = ? WHERE id = ?", p.handle, userId);
  if (p.provider === "github") await q.run("UPDATE users SET github = ? WHERE id = ?", p.handle, userId);
}

/**
 * Sign in with a provider profile. Returns the user id and whether the account
 * is new. Existing identities refresh their avatar and handle; unknown ones
 * create a user. Accounts are never merged by email, which would let anyone who
 * controls an address on one provider take over an account made with another.
 */
export function signInWithProfile(p: OAuthProfile, tz: string): Promise<{ userId: number; created: boolean }> {
  return tx(async (q) => {
    const existing = await q.get<{ user_id: number }>(
      "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?", p.provider, p.id,
    );
    if (existing) {
      await q.run("UPDATE oauth_accounts SET handle = ? WHERE provider = ? AND provider_user_id = ?", p.handle, p.provider, p.id);
      if (p.avatar) await q.run("UPDATE users SET avatar_url = ? WHERE id = ?", p.avatar, existing.user_id);
      await applyVerifiedHandle(q, existing.user_id, p);
      return { userId: existing.user_id, created: false };
    }
    const username = await uniqueUsername(q, p.handle || p.email?.split("@")[0] || p.name || "dev");
    const twitter = p.provider === "x" ? p.handle : (p.declaredTwitter ?? "");
    const res = await q.run(
      `INSERT INTO users (username, email, display_name, avatar_url, bio, twitter, github, location, timezone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      username, p.email, (p.name || username).slice(0, 50), p.avatar, p.bio.slice(0, 200),
      twitter, p.provider === "github" ? p.handle : "", p.location.slice(0, 60), tz, nowSec(),
    );
    const userId = res.lastInsertRowid;
    forgetTimeZones();
    await q.run(
      "INSERT INTO oauth_accounts (provider, provider_user_id, user_id, handle, created_at) VALUES (?, ?, ?, ?, ?)",
      p.provider, p.id, userId, p.handle, nowSec(),
    );
    return { userId, created: true };
  });
}

/** Attach a provider identity to an already signed-in user. */
export function linkProfile(userId: number, p: OAuthProfile): Promise<"linked" | "taken"> {
  return tx(async (q) => {
    const owner = await q.get<{ user_id: number }>(
      "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?", p.provider, p.id,
    );
    if (owner && owner.user_id !== userId) return "taken";
    await q.run(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, handle, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, provider) DO UPDATE SET provider_user_id = excluded.provider_user_id, handle = excluded.handle`,
      p.provider, p.id, userId, p.handle, nowSec(),
    );
    await applyVerifiedHandle(q, userId, p);
    if (p.avatar) await q.run("UPDATE users SET avatar_url = CASE WHEN avatar_url = '' THEN ? ELSE avatar_url END WHERE id = ?", p.avatar, userId);
    return "linked";
  });
}
