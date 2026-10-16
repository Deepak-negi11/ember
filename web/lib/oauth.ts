import { createHash, randomBytes } from "node:crypto";
import type { OAuthProfile, Provider } from "./accounts.ts";

// OAuth 2.0 authorization-code flow with PKCE for GitHub, Google and X. Client ids and
// secrets come from the environment (see .env.example); a provider without
// credentials is simply reported as not configured.

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
}

const PROVIDERS: Record<Provider, () => ProviderConfig> = {
  github: () => ({
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }),
  x: () => ({
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scope: "users.read tweet.read",
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
  }),
  google: () => ({
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }),
};

export const isProvider = (p: string): p is Provider => p === "github" || p === "google" || p === "x";

export function providerConfigured(p: Provider): boolean {
  const c = PROVIDERS[p]();
  return !!(c.clientId && c.clientSecret);
}

export const OAUTH_COOKIE = "ember_oauth";

/** Dev-only "sign in as" shortcut: needs EMBER_DEV_LOGIN=1 and a non-production build. */
export const devLoginEnabled = () => process.env.NODE_ENV !== "production" && process.env.EMBER_DEV_LOGIN === "1";

export interface PendingAuth {
  provider: Provider;
  state: string;
  verifier: string;
  link: boolean;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function redirectUri(origin: string, p: Provider) {
  return `${process.env.EMBER_URL?.replace(/\/$/, "") || origin}/api/auth/callback/${p}`;
}

/** Build the provider's consent URL plus the state to remember in a cookie. */
export function beginAuth(p: Provider, origin: string, link: boolean): { url: string; pending: PendingAuth } {
  const c = PROVIDERS[p]();
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.clientId!,
    redirect_uri: redirectUri(origin, p),
    scope: c.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (p === "google") params.set("prompt", "select_account");
  return { url: `${c.authorizeUrl}?${params}`, pending: { provider: p, state, verifier, link } };
}

async function postForm(url: string, body: URLSearchParams, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { access_token?: string };
}

async function getJson(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return res.json();
}

/** Exchange the code and fetch a normalised profile. Throws on any failure. */
export async function completeAuth(pending: PendingAuth, code: string, origin: string): Promise<OAuthProfile> {
  const p = pending.provider;
  const c = PROVIDERS[p]();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin, p),
    code_verifier: pending.verifier,
    client_id: c.clientId!,
  });

  if (p === "x") {
    // Confidential X apps authenticate the token request with HTTP Basic.
    const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
    const tok = await postForm(c.tokenUrl, body, { Authorization: `Basic ${basic}` });
    if (!tok.access_token) throw new Error("X returned no access token");
    const me = (await getJson("https://api.x.com/2/users/me?user.fields=profile_image_url,description,location", tok.access_token)) as {
      data?: { id: string; name: string; username: string; profile_image_url?: string; description?: string; location?: string };
    };
    if (!me.data?.id) throw new Error("X returned no user");
    return {
      provider: "x",
      id: me.data.id,
      name: me.data.name,
      handle: me.data.username,
      email: null,
      // X serves a 48px "_normal" image by default; ask for the 400px version.
      avatar: me.data.profile_image_url?.replace("_normal.", "_400x400.") ?? "",
      bio: me.data.description ?? "",
      location: me.data.location ?? "",
    };
  }

  if (p === "github") {
    body.set("client_secret", c.clientSecret!);
    const tok = await postForm(c.tokenUrl, body);
    if (!tok.access_token) throw new Error("GitHub returned no access token");
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "ember-app" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GitHub profile fetch failed: ${res.status}`);
    const u = (await res.json()) as {
      id: number; login: string; name: string | null; avatar_url?: string; bio?: string | null; location?: string | null; twitter_username?: string | null;
    };
    return {
      provider: "github",
      id: String(u.id),
      name: u.name ?? u.login,
      handle: u.login,
      email: null,
      avatar: u.avatar_url ?? "",
      bio: u.bio ?? "",
      location: u.location ?? "",
      declaredTwitter: u.twitter_username && /^[A-Za-z0-9_]{1,15}$/.test(u.twitter_username) ? u.twitter_username : undefined,
    };
  }

  body.set("client_secret", c.clientSecret!);
  const tok = await postForm(c.tokenUrl, body);
  if (!tok.access_token) throw new Error("Google returned no access token");
  const info = (await getJson("https://openidconnect.googleapis.com/v1/userinfo", tok.access_token)) as {
    sub: string; name?: string; email?: string; email_verified?: boolean; picture?: string;
  };
  if (!info.sub) throw new Error("Google returned no subject");
  return {
    provider: "google",
    id: info.sub,
    name: info.name ?? "",
    handle: "",
    email: info.email_verified && info.email ? info.email : null,
    avatar: info.picture ?? "",
    bio: "",
    location: "",
  };
}
