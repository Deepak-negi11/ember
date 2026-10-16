"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Key } from "@phosphor-icons/react";
import { CopyButton } from "./forms.tsx";

const DEFAULT_API = "https://ember-dev.vercel.app";
const EXTENSION_ID = "ember-dev.ember";
const EXTENSION_NAME = "Ember: Coding Time Tracker";

type Step = { text: React.ReactNode; cmd?: string };

const MANAGERS = [
  { id: "npm", install: "npm install -g embertime", once: "npx embertime" },
  { id: "bun", install: "bun add -g embertime", once: "bunx embertime" },
  { id: "pnpm", install: "pnpm add -g embertime", once: "pnpm dlx embertime" },
] as const;

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="num rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[12px]">{children}</kbd>;
}

function Cmd({ cmd }: { cmd: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <pre className="num min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{cmd}</pre>
      <CopyButton text={cmd} />
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-5">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-3">
          <span className="num grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{i + 1}</span>
          <div className="min-w-0 pt-0.5 leading-relaxed [&_code]:num [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:text-[13px]">
            <p>{s.text}</p>
            {s.cmd && <Cmd cmd={s.cmd} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Install instructions. The terminal path installs the `embertime` CLI
 * globally; `embertime setup` then installs the editor extension from the
 * Marketplace / Open VSX and the Claude Code and Codex hooks in one go.
 */
export function SetupTabs({ origin, keyHint }: { origin: string; keyHint?: string | null }) {
  const [tab, setTab] = useState<"terminal" | "editor" | "manage">("terminal");
  const [pm, setPm] = useState<(typeof MANAGERS)[number]["id"]>("npm");
  const reduce = useReducedMotion();
  const manager = MANAGERS.find((m) => m.id === pm)!;
  const apiFlag = origin === DEFAULT_API ? "" : ` --api-url ${origin}`;

  const panels: Record<typeof tab, React.ReactNode> = {
    terminal: (
      <>
        <div className="mb-5 flex w-fit gap-1 rounded-lg border border-line p-0.5 text-sm" role="tablist" aria-label="Package manager">
          {MANAGERS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === pm}
              onClick={() => setPm(m.id)}
              className={`num rounded-md px-3 py-1 transition-colors ${m.id === pm ? "bg-ink text-paper" : "text-muted hover:text-text"}`}
            >
              {m.id}
            </button>
          ))}
        </div>
        <Steps
          steps={[
            { text: "Install the Ember CLI globally.", cmd: manager.install },
            {
              text: <>Connect everything. This installs the extension in VS Code, Cursor and Windsurf, and the hooks in Claude Code and Codex. Replace <b>YOUR_KEY</b> with your key.</>,
              cmd: `embertime setup --key YOUR_KEY${apiFlag}`,
            },
            { text: <>Using Codex? Open it and run <b>/hooks</b> once to trust the Ember entries.</> },
          ]}
        />
        <p className="mt-5 text-sm text-muted">
          Prefer not to install anything globally? Run it once with <code className="num rounded bg-surface-2 px-1 text-[13px]">{manager.once} setup --key YOUR_KEY{apiFlag}</code>.
        </p>
      </>
    ),
    editor: (
      <Steps
        steps={[
          {
            text: (
              <>
                Open the Extensions view (<Kbd>⇧⌘X</Kbd> / <Kbd>Ctrl+Shift+X</Kbd>), search <b>Ember</b> and install <b>{EXTENSION_NAME}</b>. Works in VS Code, Cursor and Windsurf. Or from a terminal:
              </>
            ),
            cmd: `code --install-extension ${EXTENSION_ID}\ncursor --install-extension ${EXTENSION_ID}`,
          },
          { text: <>Open the command palette (<Kbd>⇧⌘P</Kbd>), run <b>Ember: Set API Key</b> and paste your key. A flame with today&apos;s time appears in the status bar.</> },
          ...(origin === DEFAULT_API
            ? []
            : [{ text: <>Point it at this server in your editor&apos;s <b>settings.json</b>:</>, cmd: `"ember.apiUrl": "${origin}"` }]),
        ]}
      />
    ),
    manage: (
      <Steps
        steps={[
          { text: "See what is connected, today's time and anything waiting to sync.", cmd: "embertime status" },
          { text: "Re-run setup after installing a new editor or agent. It is safe to run again.", cmd: `embertime setup${apiFlag}` },
          { text: "Remove the hooks and extension. Add --purge to delete local data too.", cmd: "embertime uninstall" },
        ]}
      />
    ),
  };

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 text-sm [scrollbar-width:none]" role="tablist">
        {([["terminal", "Terminal (recommended)"], ["editor", "Editor only"], ["manage", "Status & remove"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            onClick={() => setTab(id)}
            className="relative shrink-0 rounded-lg px-4 py-2 font-medium transition-colors"
          >
            {id === tab && (
              <motion.span
                layoutId="setup-pill"
                className="absolute inset-0 rounded-lg bg-surface-2"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className={`relative ${id === tab ? "text-text" : "text-muted hover:text-text"}`}>{label}</span>
          </button>
        ))}
      </div>

      {keyHint !== undefined && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Key size={15} />
          {keyHint ? <>Your key ends in <span className="num text-text">{keyHint}</span>. Lost it? Regenerate above.</> : <>Create an API key above first.</>}
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5"
          role="tabpanel"
        >
          {panels[tab]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
