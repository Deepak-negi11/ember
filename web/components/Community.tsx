import { Hand, Robot } from "@phosphor-icons/react/ssr";
import type { CommunityWeek } from "@/lib/stats.ts";
import { formatDuration } from "@/lib/time.ts";
import { HourChart } from "./HourChart.tsx";
import { EDITOR_NAMES } from "./ui.tsx";

export const AGENTS = new Set(["claude-code", "codex", "cursor-agent"]);

const h = 3600;

/**
 * A fixed, made-up week for the landing page, so it looks the same for every
 * visitor and never shows real people's data. Shown with a "Sample data" note.
 */
export const SAMPLE_WEEK: CommunityWeek = {
  seconds: 1240 * h,
  aiSeconds: 410 * h,
  devs: 86,
  projects: 142,
  // Quiet nights, a morning ramp, a dip at lunch and a long evening peak.
  hours: [14, 8, 4, 2, 1, 1, 3, 9, 26, 52, 70, 76, 58, 62, 74, 78, 72, 66, 61, 70, 82, 76, 54, 30].map((x) => x * h * 0.62),
  languages: [
    { name: "TypeScript", seconds: 412 * h },
    { name: "Python", seconds: 236 * h },
    { name: "Rust", seconds: 148 * h },
    { name: "Go", seconds: 104 * h },
    { name: "C++", seconds: 72 * h },
    { name: "SQL", seconds: 46 * h },
  ],
  editors: [
    { name: "vscode", seconds: 452 * h },
    { name: "cursor", seconds: 378 * h },
    { name: "claude-code", seconds: 236 * h },
    { name: "codex", seconds: 104 * h },
    { name: "cursor-agent", seconds: 70 * h },
  ],
  stacks: [
    { name: "Next.js", projects: 38 },
    { name: "React", projects: 34 },
    { name: "Tailwind CSS", projects: 29 },
    { name: "FastAPI", projects: 17 },
    { name: "PostgreSQL", projects: 15 },
    { name: "Prisma", projects: 12 },
    { name: "Tokio", projects: 9 },
    { name: "Docker", projects: 9 },
    { name: "PyTorch", projects: 7 },
    { name: "Express", projects: 6 },
  ],
};

/** The community view: when people code, top languages, hands-on vs agents and stacks. */
export function Community({ week: w }: { week: CommunityWeek }) {
  const handsOn = w.seconds - w.aiSeconds;
  const handsPct = Math.round((handsOn / w.seconds) * 100);
  const langMax = w.languages[0]?.seconds ?? 1;
  const langTotal = w.languages.reduce((a, l) => a + l.seconds, 0);

  return (
    <div className="grid gap-4 md:grid-cols-6">
      {/* Hour of day */}
      <section
        className="rounded-3xl border border-line p-6 shadow-card sm:p-8 md:col-span-4"
        style={{ background: "radial-gradient(120% 90% at 100% 0%, var(--accent-soft), transparent 60%), var(--surface)" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h3 className="font-display text-2xl font-medium tracking-tight">When people code</h3>
          <p className="text-sm text-muted">
            <span className="num font-semibold text-text">{formatDuration(w.seconds)}</span> by{" "}
            <span className="num font-semibold text-text">{w.devs}</span> {w.devs === 1 ? "developer" : "developers"}, in their own time zones
          </p>
        </div>
        <div className="mt-6">
          <HourChart hours={w.hours} />
        </div>
      </section>

      {/* Languages */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8 md:col-span-2">
        <h3 className="font-display text-2xl font-medium tracking-tight">Top languages</h3>
        <ol className="mt-6 grid gap-4">
          {w.languages.map((l, i) => (
            <li key={l.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">
                  <span className="num mr-2 text-faint">{i + 1}</span>
                  {l.name}
                </span>
                <span className="num text-muted">{Math.round((l.seconds / langTotal) * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(4, (l.seconds / langMax) * 100)}%`, opacity: 0.35 + 0.65 * (l.seconds / langMax) }} />
            </li>
          ))}
        </ol>
      </section>

      {/* Hands-on vs agents */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8 md:col-span-2">
        <h3 className="font-display text-2xl font-medium tracking-tight">Keyboard vs agents</h3>
        <p className="mt-6 font-display text-5xl font-medium tracking-tight tabular-nums">
          {handsPct}%
        </p>
        <p className="mt-1 text-sm text-muted">of this week was hands-on in an editor.</p>
        <div className="mt-5 flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          <span className="bg-ink" style={{ flexGrow: handsOn }} />
          <span className="bg-accent" style={{ flexGrow: w.aiSeconds }} />
        </div>
        <ul className="mt-5 grid gap-2 text-sm">
          {w.editors.map((e) => (
            <li key={e.name} className="flex items-center gap-2.5">
              {AGENTS.has(e.name) ? <Robot size={15} className="text-accent" /> : <Hand size={15} className="text-muted" />}
              <span className="flex-1">{EDITOR_NAMES[e.name] ?? e.name}</span>
              <span className="num text-muted">{formatDuration(e.seconds)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Stacks */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8 md:col-span-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="font-display text-2xl font-medium tracking-tight">What people are building with</h3>
          <p className="text-sm text-muted">
            Across <span className="num font-semibold text-text">{w.projects}</span> active {w.projects === 1 ? "project" : "projects"}
          </p>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2.5">
          {w.stacks.map((s, i) => (
            <li
              key={s.name}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 ${
                i < 3 ? "border-accent/30 bg-accent-soft text-base font-semibold" : "border-line bg-surface-2 text-sm font-medium"
              }`}
            >
              {s.name}
              <span className="num text-xs font-normal text-muted">{s.projects}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-faint">Detected from package.json, Cargo.toml, pyproject.toml, go.mod and other manifests. Counts are projects, not people.</p>
      </section>
    </div>
  );
}
