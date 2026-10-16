import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser, rateLimit } from "@/lib/auth.ts";
import { OAUTH_COOKIE, beginAuth, isProvider, providerConfigured } from "@/lib/oauth.ts";

/** Start sign-in (or account linking with ?link=1) with X or Google. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const origin = new URL(req.url).origin;
  if (!isProvider(provider)) return NextResponse.redirect(new URL("/login?error=unknown", origin));
  if (!providerConfigured(provider)) return NextResponse.redirect(new URL(`/login?error=not_configured&provider=${provider}`, origin));

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`oauth:${ip}`, 30, 600)) return NextResponse.redirect(new URL("/login?error=rate_limited", origin));

  const link = new URL(req.url).searchParams.get("link") === "1" && !!(await currentUser());
  const { url, pending } = beginAuth(provider, origin, link);
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: 600,
  });
  return NextResponse.redirect(url);
}
