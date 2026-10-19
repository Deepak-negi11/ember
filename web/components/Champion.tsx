import Link from "next/link";
import { ArrowUpRight, Crown, XLogo } from "@phosphor-icons/react/ssr";
import type { LeaderRow } from "@/lib/stats.ts";
import { Avatar } from "./ui.tsx";
import { GitHubMark } from "./BrandIcons.tsx";

const RAMP = ["var(--h4)", "var(--h3)", "var(--h2)", "var(--h1)"];

type Person = Pick<LeaderRow, "username" | "display_name" | "avatar_url" | "quote" | "bio" | "twitter" | "github" | "location">;

/**
 * The #1 spot: their one-line quote with their name, their X account, and what
 * they won with (languages on the coding board, models on the AI board).
 */
export function Champion({ row, period, stat, chips, chipsTitle }: {
  row: Person;
  period: string;
  /** The winning number, e.g. "5h 12m" or "48.2M tokens". */
  stat: string;
  chips: { name: string; value: string }[];
  chipsTitle: string;
}) {
  const quote = row.quote || row.bio;
  const langs = chips.slice(0, 8);
  const more = chips.length - langs.length;

  return (
    <section
      className="rise overflow-hidden rounded-[32px] border border-line shadow-card"
      style={{ background: "radial-gradient(110% 140% at 0% 0%, var(--accent-soft), transparent 55%), var(--surface)" }}
    >
      <div className="grid lg:grid-cols-[1.35fr_1fr]">
        {/* Quote + who said it */}
        <figure className="flex flex-col justify-between gap-10 p-7 sm:p-10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-accent-text">
            <span className="flex items-center gap-2"><Crown size={18} weight="fill" /> #1 {period}</span>
            <span className="num rounded-lg bg-accent-soft px-2 py-0.5 text-xs">{stat}</span>
          </div>

          {quote ? (
            <blockquote className="break-words font-display text-[28px] font-medium leading-[1.15] tracking-tight sm:text-4xl">
              &ldquo;{quote}&rdquo;
            </blockquote>
          ) : (
            <p className="font-display text-[28px] font-medium leading-[1.15] tracking-tight text-muted sm:text-4xl">
              {row.display_name.split(" ")[0]} is leading and hasn&apos;t written a quote yet.
            </p>
          )}

          <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-4">
            <Link href={`/u/${row.username}`} className="flex items-center gap-3 rounded-full pr-2 transition-opacity hover:opacity-85">
              <Avatar name={row.display_name} src={row.avatar_url} size={48} />
              <span>
                <span className="block text-lg font-semibold leading-tight">{row.display_name}</span>
                <span className="block text-sm text-muted">{row.location || `@${row.username}`}</span>
              </span>
            </Link>
            {row.github && (
              <a
                href={`https://github.com/${row.github}`}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold transition-[background-color,transform] hover:bg-surface-2 active:scale-[0.98]"
                aria-label={`${row.display_name} on GitHub (opens github.com)`}
              >
                <GitHubMark size={16} /> {row.github}
              </a>
            )}
            {row.twitter && (
              <a
                href={`https://x.com/${row.twitter}`}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="group inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
                aria-label={`${row.display_name} on X (opens x.com)`}
              >
                <XLogo size={16} weight="bold" /> @{row.twitter}
                <ArrowUpRight size={14} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            )}
          </figcaption>
        </figure>

        {/* Languages */}
        {langs.length > 0 && (
          <div className="flex flex-col justify-center border-t border-line p-7 sm:p-10 lg:border-l lg:border-t-0">
            <p className="text-sm font-semibold">{chipsTitle}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {langs.map((l, i) => (
                <li key={l.name} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm">
                  <span className="size-2 rounded-full" style={{ background: RAMP[i] ?? "var(--line-strong)" }} />
                  <span className="font-medium">{l.name}</span>
                  <span className="num text-xs text-muted">{l.value}</span>
                </li>
              ))}
              {more > 0 && <li className="rounded-xl px-2 py-1.5 text-sm text-muted">+{more} more</li>}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
