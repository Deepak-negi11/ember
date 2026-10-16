import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { createSession, currentUser } from "@/lib/auth.ts";
import { linkProfile, signInWithProfile } from "@/lib/accounts.ts";
import { OAUTH_COOKIE, completeAuth, isProvider, type PendingAuth } from "@/lib/oauth.ts";
import { isValidTimeZone } from "@/lib/time.ts";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, url.origin));

  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth" });

  if (url.searchParams.get("error")) return fail("denied");
  let pending: PendingAuth;
  try {
    pending = JSON.parse(raw ?? "");
  } catch {
    return fail("expired");
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!isProvider(provider) || pending.provider !== provider || !code || !same(state, pending.state)) return fail("state");

  try {
    const profile = await completeAuth(pending, code, url.origin);
    const me = pending.link ? await currentUser() : null;
    if (me) {
      const result = await linkProfile(me.id, profile);
      return NextResponse.redirect(new URL(`/settings?${result === "linked" ? "linked" : "link_error"}=${provider}#accounts`, url.origin));
    }
    const tz = jar.get("ember_tz")?.value ?? "UTC";
    const { userId, created } = await signInWithProfile(profile, isValidTimeZone(tz) ? tz : "UTC");
    await createSession(userId);
    return NextResponse.redirect(new URL(created ? "/leaderboard?welcome=1" : "/leaderboard", url.origin));
  } catch (err) {
    console.error(`[auth] ${provider} sign-in failed:`, err instanceof Error ? err.message : err);
    return fail("oauth_failed");
  }
}
