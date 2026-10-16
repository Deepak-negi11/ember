import { Star } from "@phosphor-icons/react/ssr";
import { GitHubMark } from "@/components/BrandIcons.tsx";
import { GITHUB_REPO } from "@/lib/site.ts";

/** Star count from GitHub's public API, cached for an hour. Returns null when
 *  GitHub is unreachable or rate-limited, so the button still renders. */
async function starCount(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** "GitHub | ★ Star 12" pill linking to the repository. */
export async function GitHubStar() {
  const stars = await starCount();
  return (
    <a
      href={`https://github.com/${GITHUB_REPO}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Star Ember on GitHub${stars ? ` (${stars} stars)` : ""}`}
      className="group inline-flex h-10 items-center rounded-xl border border-line bg-surface-2/60 text-sm font-medium text-text transition-[background-color,border-color,transform] duration-150 hover:border-line-strong hover:bg-surface-2 active:scale-[0.98]"
    >
      <span className="grid h-full place-items-center pl-3 pr-2.5">
        <GitHubMark size={18} />
      </span>
      <span aria-hidden className="h-4 w-px bg-line-strong" />
      <span className="flex items-center gap-1.5 pl-2.5 pr-3">
        <Star size={15} weight="fill" className="text-faint transition-colors duration-200 group-hover:text-[#e3b341]" />
        <span className="max-sm:hidden">Star</span>
        {stars ? <span className="tabular-nums text-muted">{compact.format(stars)}</span> : null}
      </span>
    </a>
  );
}
