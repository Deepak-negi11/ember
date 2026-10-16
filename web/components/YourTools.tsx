import { Code, OpenAiLogo, TerminalWindow } from "@phosphor-icons/react/ssr";
import { siClaude, siCursor, siVscodium, siWindsurf } from "simple-icons";
import { all } from "@/lib/db.ts";
import { addDays } from "@/lib/time.ts";
import { todayFor } from "@/lib/stats.ts";

type Tool = { id: string; name: string; kind: "Editor" | "AI agent"; icon: React.ReactNode };

const brand = (path: string) => (
  <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden fill="currentColor">
    <path d={path} />
  </svg>
);

const TOOLS: Tool[] = [
  { id: "vscode", name: "VS Code", kind: "Editor", icon: <Code size={18} weight="bold" /> },
  { id: "cursor", name: "Cursor", kind: "Editor", icon: brand(siCursor.path) },
  { id: "windsurf", name: "Windsurf", kind: "Editor", icon: brand(siWindsurf.path) },
  { id: "claude-code", name: "Claude Code", kind: "AI agent", icon: brand(siClaude.path) },
  { id: "codex", name: "Codex", kind: "AI agent", icon: <OpenAiLogo size={18} weight="bold" /> },
  { id: "cursor-agent", name: "Cursor Agent", kind: "AI agent", icon: <TerminalWindow size={18} weight="bold" /> },
];
const OPTIONAL = new Set(["windsurf"]);

function ago(sec: number) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 120) return "Coded just now";
  if (d < 3600) return `Coded ${Math.round(d / 60)} min ago`;
  if (d < 86400) return `Coded ${Math.round(d / 3600)} h ago`;
  const days = Math.round(d / 86400);
  return `Coded ${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * Which editors and agents tracked coding in the last 30 days. Built from real
 * heartbeats only: "Coded …" needs a writing heartbeat (the same ones that count
 * as time), "Connected" means the tool reported in but nothing was written yet.
 * Ember can't see what's installed on your machine, so a tool that never sent
 * anything shows "No activity yet".
 */
export async function YourTools({ userId, timezone }: { userId: number; timezone: string }) {
  const since = addDays(todayFor(timezone), -30);
  const seen = await all<{ editor: string; last: number; last_write: number | null }>(
    `SELECT editor, MAX(time) AS last, MAX(CASE WHEN is_write = 1 THEN time END) AS last_write
       FROM heartbeats WHERE user_id = ? AND local_date >= ? GROUP BY editor`,
    userId, since,
  );
  const byId = new Map(seen.map((s) => [s.editor, s]));
  // VSCodium and any other editor id that reported in also get a tile.
  const extra: Tool[] = seen
    .filter((s) => !TOOLS.some((t) => t.id === s.editor))
    .map((s) => ({ id: s.editor, name: s.editor === "vscodium" ? "VSCodium" : s.editor, kind: "Editor", icon: s.editor === "vscodium" ? brand(siVscodium.path) : <Code size={18} /> }));
  const tools = [...TOOLS.filter((t) => byId.has(t.id) || !OPTIONAL.has(t.id)), ...extra];
  const coding = tools.filter((t) => byId.get(t.id)?.last_write).length;

  return (
    <section aria-labelledby="tools-title">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id="tools-title" className="font-display text-2xl font-medium tracking-tight">Your tools</h2>
          <p className="mt-1 text-sm text-muted">
            {coding === 0 ? "No coding tracked in the last 30 days yet." : `${coding} of ${tools.length} tracked coding in the last 30 days.`}
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => {
          const s = byId.get(t.id);
          const wrote = s?.last_write ?? null;
          return (
            <li key={t.id} className={`flex items-center gap-3.5 rounded-2xl border p-4 ${wrote ? "border-line bg-surface shadow-card" : "border-dashed border-line-strong"}`}>
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${wrote ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-faint"}`}>{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {t.name}
                  <span className="text-[11px] font-normal text-faint">{t.kind}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                  {wrote ? (
                    <>
                      <span className="size-1.5 rounded-full bg-[#22c55e]" aria-hidden />
                      {ago(wrote)}
                    </>
                  ) : s ? (
                    <span>Connected, no code written yet</span>
                  ) : (
                    <span className="text-faint">No activity yet</span>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {coding < tools.length && (
        <p className="mt-3 text-sm text-muted">
          A tool shows up here after you write code with it. Installed one recently? Run{" "}
          <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">embertime setup</code> once to connect it.
        </p>
      )}
    </section>
  );
}
