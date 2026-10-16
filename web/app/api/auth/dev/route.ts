import { NextResponse } from "next/server";
import { createSession, userByUsername } from "@/lib/auth.ts";
import { devLoginEnabled } from "@/lib/oauth.ts";

// Local-only shortcut for trying the app without OAuth credentials.

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!devLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const user = await userByUsername(url.searchParams.get("u") ?? "");
  if (!user) return NextResponse.redirect(new URL("/login?error=dev_unknown", url.origin));
  await createSession(user.id);
  return NextResponse.redirect(new URL("/dashboard", url.origin));
}
