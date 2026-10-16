import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.X_CLIENT_ID = "test-client";
process.env.X_CLIENT_SECRET = "test-secret";
delete process.env.GOOGLE_CLIENT_ID;
const { beginAuth, providerConfigured } = await import("./oauth.ts");

test("X authorize URL uses PKCE S256, state and the exact callback", () => {
  const { url, pending } = beginAuth("x", "http://localhost:3001", false);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:3001/api/auth/callback/x");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), createHash("sha256").update(pending.verifier).digest("base64url"));
  assert.equal(u.searchParams.get("state"), pending.state);
  assert.ok(pending.state.length >= 32 && pending.verifier.length >= 43);
});

test("providers without credentials report as not configured", () => {
  assert.equal(providerConfigured("x"), true);
  assert.equal(providerConfigured("google"), false);
});
