import Link from "next/link";
import { CaretDown, CaretUp } from "@phosphor-icons/react/ssr";
import type { LeaderRow } from "@/lib/stats.ts";
import { formatDuration } from "@/lib/time.ts";
import { Avatar } from "./ui.tsx";
import { GitHubMark, XMark } from "./BrandIcons.tsx";

/** Ranked rows shared by the leaderboard page and the dashboard. */
/** ▲/▼ versus the previous period, "New" for first-timers. */
function Movement({ now, before }: { now: number; before?: number }) {
  if (before === undefined) return <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-text">New</span>;
  const d = before - now;
  if (d === 0) return <span className="text-xs text-faint" aria-label="No change">–</span>;
  return d > 0 ? (
    <span className="flex items-center text-xs font-semibold text-[#16a34a] [:root[data-theme=dark]_&]:text-[#4ade80]" aria-label={`Up ${d}`}>
      <CaretUp size={11} weight="fill" />{d}
    </span>
  ) : (
    <span className="flex items-center text-xs font-semibold text-muted" aria-label={`Down ${-d}`}>
      <CaretDown size={11} weight="fill" />{-d}
    </span>
  );
}

export function LeaderRows({
  rows, meId, gapBefore, prevRanks, language,
}: {
  rows: LeaderRow[];
  meId?: number;
  gapBefore?: number;
  prevRanks?: Map<number, number>;
  /** When ranking one language, the line under the name describes that language instead of AI share. */
  language?: string;
}) {
  return (
    <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map((r, i) => {
        const mine = meId === r.user_id;
        const aiShare = r.seconds ? Math.round((r.ai_seconds / r.seconds) * 100) : 0;
        // Detected frameworks and tools; languages stand in when no manifest was found.
        const tags = r.stack.length ? r.stack : r.languages.map((l) => l.name);
        return (
          <li
            key={r.user_id}
            className={`rise relative border-line transition-colors hover:bg-surface-2 [&:not(:first-child)]:border-t ${mine ? "bg-accent-soft" : ""} ${gapBefore === r.rank ? "!border-t-2 border-dashed" : ""}`}
            style={{ ["--d" as string]: Math.min(i, 12) }}
          >
            <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-3.5 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,17rem)_6rem] sm:px-6">
              <span className="flex flex-col items-start leading-none">
                <span className={`num text-lg font-semibold ${r.rank <= 3 ? "text-accent-text" : "text-faint"}`}>{r.rank}</span>
                {prevRanks && <span className="mt-1"><Movement now={r.rank} before={prevRanks.get(r.user_id)} /></span>}
              </span>
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={r.display_name} src={r.avatar_url} size={36} />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    {/* Stretched link: the whole row opens the profile; the icon links sit above it. */}
                    <Link href={`/u/${r.username}`} className="truncate font-medium after:absolute after:inset-0">
                      {r.display_name}
                    </Link>
                    {mine && <span className="text-xs font-semibold text-accent-text">You</span>}
                    <span className="relative z-[1] flex shrink-0 items-center gap-1 text-faint">
                      {r.github && (
                        <a href={`https://github.com/${r.github}`} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${r.display_name} on GitHub`} className="rounded-md p-1 transition-colors hover:bg-surface hover:text-text">
                          <GitHubMark size={14} />
                        </a>
                      )}
                      {r.twitter && (
                        <a href={`https://x.com/${r.twitter}`} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${r.display_name} on X`} className="rounded-md p-1 transition-colors hover:bg-surface hover:text-text">
                          <XMark size={12} />
                        </a>
                      )}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-muted">
                    @{r.username} · {language ? (r.top_language === language ? "Main language" : "Also uses it") : `${aiShare}% with AI`}
                  </span>
                </span>
              </span>
              <span className="hidden min-w-0 flex-wrap justify-end gap-1.5 sm:flex" aria-label="Tech stack">
                {tags.slice(0, 3).map((t) => (
                  <span key={t} className="max-w-[9rem] truncate rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-xs text-muted">{t}</span>
                ))}
                {tags.length > 3 && <span className="rounded-lg px-1 py-0.5 text-xs text-faint">+{tags.length - 3}</span>}
              </span>
              <span className="num text-right font-semibold">{formatDuration(r.seconds)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
