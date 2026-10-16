import { NextResponse } from "next/server";
import { rateLimit, userFromApiKey } from "@/lib/auth.ts";
import { MAX_BATCH, parseHeartbeat, type ParsedHeartbeat } from "@/lib/heartbeat.ts";
import { ingest } from "@/lib/stats.ts";

const MAX_BODY_BYTES = 512 * 1024;

export async function POST(req: Request) {
  const user = await userFromApiKey(req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });

  // Collectors flush every ~30s; 120 requests/minute leaves room for offline-queue catch-up.
  if (!rateLimit(`hb:${user.id}`, 120, 60)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "body_too_large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const list = (body as { heartbeats?: unknown })?.heartbeats;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) {
    return NextResponse.json({ error: `heartbeats must be an array of 1-${MAX_BATCH} items` }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const parsed: ParsedHeartbeat[] = [];
  let rejected = 0;
  for (const raw of list) {
    const hb = parseHeartbeat(raw, now);
    if (hb) parsed.push(hb);
    else rejected++;
  }
  if (parsed.length === 0) return NextResponse.json({ error: "no_valid_heartbeats", rejected }, { status: 400 });

  const { accepted, duplicates } = await ingest(user.id, user.timezone, parsed);
  return NextResponse.json({ accepted, duplicates, rejected }, { status: 202 });
}
