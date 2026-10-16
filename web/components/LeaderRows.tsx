import Link from "next/link";
import type { LeaderRow } from "@/lib/stats.ts";
import { formatDuration } from "@/lib/time.ts";
import { Avatar } from "./ui.tsx";

/** Ranked rows shared by the leaderboard page and the dashboard. `max` is the #1 time, for the bars. */
export function LeaderRows({ rows, meId, max, gapBefore }: { rows: LeaderRow[]; meId?: number; max: number; gapBefore?: number }) {
  return (
    <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map((r, i) => {
        const mine = meId === r.user_id;
        const aiShare = r.seconds ? Math.round((r.ai_seconds / r.seconds) * 100) : 0;
        return (
          <li
            key={r.user_id}
            className={`rise border-line [&:not(:first-child)]:border-t ${mine ? "bg-accent-soft" : ""} ${gapBefore === r.rank ? "!border-t-2 border-dashed" : ""}`}
            style={{ ["--d" as string]: Math.min(i, 12) }}
          >
            <Link
              href={`/u/${r.username}`}
              className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2 sm:grid-cols-[3rem_1fr_9rem_7rem] sm:px-6"
            >
              <span className={`num text-lg font-semibold ${r.rank <= 3 ? "text-accent-text" : "text-faint"}`}>{r.rank}</span>
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={r.display_name} src={r.avatar_url} size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {r.display_name}
                    {mine && <span className="ml-2 text-xs font-semibold text-accent-text">You</span>}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    @{r.username}
                    {r.languages.length > 0 && <> · {r.languages.slice(0, 3).map((l) => l.name).join(", ")}{r.languages.length > 3 && ` +${r.languages.length - 3}`}</>}
                  </span>
                </span>
              </span>
              <span className="hidden text-sm text-muted sm:block">
                {aiShare}% with AI
                <span className="mt-1.5 block h-1 rounded-full bg-accent" style={{ width: `${Math.max(4, (r.seconds / max) * 100)}%`, opacity: 0.35 + 0.65 * (r.seconds / max) }} />
              </span>
              <span className="num text-right font-semibold">{formatDuration(r.seconds)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
