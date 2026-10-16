import Link from "next/link";
import { Fire } from "@phosphor-icons/react/ssr";
import { formatDuration } from "@/lib/time.ts";

export { btn } from "./styles.ts";

/** Small orange section label. */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-accent-soft px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-accent-text">
      {children}
    </span>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-text" aria-label="Ember home">
      <Fire weight="fill" size={24} className="flicker text-accent" />
      <span className="font-display text-[22px] font-medium tracking-tight">
        em<span className="text-accent">ber</span>
      </span>
    </Link>
  );
}

/** Monogram avatar in the orange family; hue and angle vary per user so
 *  people stay distinguishable at a glance. */
export function Avatar({ name, size = 40, src }: { name: string; size?: number; src?: string }) {
  if (src) {
    return (
      // Provider-hosted photo (X or Google). no-referrer avoids hotlink blocks.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" className="shrink-0 rounded-full bg-surface-2 object-cover" style={{ width: size, height: size }} />
    );
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = 8 + (h % 26);
  const angle = h % 360;
  const initials = name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-display font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(${angle}deg, hsl(${hue} 100% 62%), hsl(${hue + 6} 100% 44%))`,
      }}
    >
      {initials}
    </span>
  );
}

export function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`rounded-3xl border border-line bg-surface shadow-card ${className}`} style={style}>
      {children}
    </section>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}

const SEGMENTS = ["var(--h4)", "var(--h3)", "var(--h2)", "var(--h1)", "var(--line-strong)"];

/** Ranked share bar. Segments use the heat ramp in rank order, so the brightest
 *  segment is always the largest share. Remaining items fold into "Other". */
export function ShareBar({ items, total }: { items: { name: string; seconds: number }[]; total: number }) {
  if (!total) return null;
  const top = items.slice(0, 4);
  const rest = total - top.reduce((a, i) => a + i.seconds, 0);
  const rows = rest > 60 ? [...top, { name: "Other", seconds: rest }] : top;
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {rows.map((r, i) => (
          <span key={r.name} style={{ flexGrow: r.seconds, background: SEGMENTS[i] }} title={r.name} />
        ))}
      </div>
      <ul className="mt-4 grid gap-2.5">
        {rows.map((r, i) => (
          <li key={r.name} className="flex items-center gap-3 text-sm">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: SEGMENTS[i] }} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="num text-muted">{formatDuration(r.seconds)}</span>
            <span className="num w-10 text-right text-faint">{Math.round((r.seconds / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const EDITOR_NAMES: Record<string, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  vscodium: "VSCodium",
  "claude-code": "Claude Code",
  codex: "Codex",
};
