import { NextResponse } from "next/server";
import { userFromApiKey } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { todayFor } from "@/lib/stats.ts";
import { formatDuration } from "@/lib/time.ts";

export async function GET(req: Request) {
  const user = await userFromApiKey(req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });

  const row = await get<{ seconds: number; username: string }>(
    `SELECT COALESCE(s.seconds, 0) AS seconds, u.username
       FROM users u LEFT JOIN daily_stats s ON s.user_id = u.id AND s.date = ?
      WHERE u.id = ?`,
    todayFor(user.timezone), user.id,
  );
  if (!row) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  return NextResponse.json({ seconds: row.seconds, text: formatDuration(row.seconds), username: row.username });
}
