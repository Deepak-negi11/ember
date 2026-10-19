import { NextResponse } from "next/server";
import { rateLimit, userFromApiKey } from "@/lib/auth.ts";
import { MAX_BATCH, parseHeartbeat, type ParsedHeartbeat } from "@/lib/heartbeat.ts";
import { ingest, ingestUsage } from "@/lib/stats.ts";
import { parseUsage, type ParsedUsage } from "@/lib/usage.ts";

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
  // { heartbeats: [...], usage?: [...] }. Agent hooks send token usage (model + counts) next to
  // heartbeats; a request may carry only usage, with an empty heartbeats array.
  const list = (body as { heartbeats?: unknown })?.heartbeats;
  const usageList = (body as { usage?: unknown })?.usage ?? [];
  if (!Array.isArray(list) || !Array.isArray(usageList) || list.length > MAX_BATCH || usageList.length > MAX_BATCH || list.length + usageList.length === 0) {
    return NextResponse.json({ error: `heartbeats must be an array of up to ${MAX_BATCH} items (and usage, if sent, too), not both empty` }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const parsed: ParsedHeartbeat[] = [];
  const usage: ParsedUsage[] = [];
  let rejected = 0;
  for (const raw of list) {
    const hb = parseHeartbeat(raw, now);
    if (hb) parsed.push(hb);
    else rejected++;
  }
  for (const raw of usageList) {
    const u = parseUsage(raw, now);
    if (u) usage.push(u);
    else rejected++;
  }
  if (parsed.length === 0 && usage.length === 0) return NextResponse.json({ error: "no_valid_heartbeats", rejected }, { status: 400 });

  const { accepted, duplicates } = await ingest(user.id, user.timezone, parsed);
  const u = await ingestUsage(user.id, user.timezone, usage);
  return NextResponse.json({ accepted, duplicates, rejected, usage: { accepted: u.accepted, duplicates: u.duplicates } }, { status: 202 });
}
