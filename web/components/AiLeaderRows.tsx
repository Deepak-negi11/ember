import Link from "next/link";
import type { AiLeaderRow } from "@/lib/stats.ts";
import { formatCost, formatTokens, modelName } from "@/lib/usage.ts";
import { Avatar, EDITOR_NAMES } from "./ui.tsx";
import { GitHubMark, XMark } from "./BrandIcons.tsx";
import { Movement } from "./LeaderRows.tsx";

/** Ranked rows for the Agents board: tokens, with the estimated spend under them. */
export function AiLeaderRows({ rows, meId, prevRanks }: { rows: AiLeaderRow[]; meId?: number; prevRanks?: Map<number, number> }) {
  return (
    <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map((r, i) => {
        const agent = r.current_agent ? (EDITOR_NAMES[r.current_agent] ?? r.current_agent) : "";
        return (
          <li
            key={r.user_id}
            className="rise relative border-line transition-colors hover:bg-surface-2 [&:not(:first-child)]:border-t"
            style={{ ["--d" as string]: Math.min(i, 12) }}
          >
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,15rem)_6.5rem] sm:px-6">
              <span className="flex flex-col items-start leading-none">
                <span className={`num text-lg font-semibold ${r.rank <= 3 ? "text-accent-text" : "text-faint"}`}>{r.rank}</span>
                {prevRanks && <span className="mt-1"><Movement now={r.rank} before={prevRanks.get(r.user_id)} /></span>}
              </span>
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={r.display_name} src={r.avatar_url} size={36} />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <Link href={`/u/${r.username}`} className="truncate font-medium after:absolute after:inset-0">
                      {r.display_name}
                    </Link>
                    {meId === r.user_id && <span className="text-xs font-semibold text-accent-text">You</span>}
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
                    @{r.username}
                    {agent && <> · <span title="Agent used most recently">{agent}</span></>}
                  </span>
                </span>
              </span>
              <span className="hidden min-w-0 flex-wrap justify-end gap-1.5 sm:flex" aria-label="Models used">
                {r.models.slice(0, 2).map((x) => (
                  <span key={x.name} className="max-w-[9rem] truncate rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-xs text-muted" title={x.name}>
                    {modelName(x.name)}
                  </span>
                ))}
                {r.models.length > 2 && <span className="rounded-lg px-1 py-0.5 text-xs text-faint">+{r.models.length - 2}</span>}
              </span>
              <span className="text-right">
                <span className="num block whitespace-nowrap font-semibold">
                  {formatTokens(r.tokens)}<span className="sr-only"> tokens</span>
                </span>
                <span className="num mt-0.5 block whitespace-nowrap text-xs text-faint" title="Estimated spend at API list prices">
                  {formatCost(r.cost_micros)}<span className="sr-only"> estimated spend</span>
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
