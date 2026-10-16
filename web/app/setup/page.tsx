import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle, Code, Key, OpenAiLogo, TerminalWindow, Wrench } from "@phosphor-icons/react/ssr";
import { currentUser } from "@/lib/auth.ts";
import { publicOrigin } from "@/lib/origin.ts";
import { ClaudeMark, CursorMark, WindsurfMark } from "@/components/BrandIcons.tsx";
import { CopyButton } from "@/components/forms.tsx";
import { btn } from "@/components/ui.tsx";

export const metadata: Metadata = {
  title: "Setup guide: track coding time in VS Code, Cursor, Claude Code and Codex",
  description:
    "Connect VS Code, Cursor, Windsurf, Claude Code, Codex and Cursor Agent to Ember in about two minutes. One npm install, one command, no file downloads.",
  alternates: { canonical: "/setup" },
};

const DEFAULT_API = "https://ember-dev.vercel.app";
const EXTENSION = "ember-dev.embertime";

function Cmd({ children }: { children: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <pre className="num min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="num rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[12px] text-text">{children}</kbd>;
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="mt-5 grid gap-5 [counter-reset:step]">{children}</ol>;
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-3 [counter-increment:step]">
      <span className="num grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text before:content-[counter(step)]" aria-hidden />
      <div className="min-w-0 pt-0.5 leading-relaxed text-muted [&_b]:text-text [&_code]:num [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:text-[13px] [&_code]:text-text">{children}</div>
    </li>
  );
}

function Section({ id, icon, title, kind, children }: { id: string; icon: React.ReactNode; title: string; kind?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-text">{icon}</span>
        <h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2>
        {kind && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-faint">{kind}</span>}
      </div>
      {children}
    </section>
  );
}

const TOC = [
  ["before", "Before you start"],
  ["quick", "Quick setup (all tools)"],
  ["vscode", "VS Code"],
  ["cursor", "Cursor"],
  ["windsurf", "Windsurf"],
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["cursor-agent", "Cursor Agent"],
  ["check", "Check it works"],
  ["help", "Troubleshooting"],
] as const;

export default async function Setup() {
  const [user, origin] = await Promise.all([currentUser(), publicOrigin()]);
  const api = origin === DEFAULT_API ? "" : ` --api-url ${origin}`;
  const setupCmd = `embertime setup --key YOUR_KEY${api}`;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
      <header className="rise max-w-3xl">
        <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">Set up Ember</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          About two minutes. One install connects every editor and AI agent you use. Nothing to download by hand, and your code never leaves your computer.
        </p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-28 grid gap-1 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text">{label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-6">
          <Section id="before" icon={<Key size={20} weight="bold" />} title="Before you start">
            <Steps>
              <Step>
                {user ? <>You&apos;re signed in.</> : <><Link href="/login" className="font-medium text-accent-text hover:underline">Sign in</Link> with GitHub or Google. Your account is created the first time.</>}
              </Step>
              <Step>
                Open <Link href="/settings#api-key" className="font-medium text-accent-text hover:underline">Settings</Link>, click <b>Create API key</b> and copy it. It starts with <code>ember_</code>. One key works for every tool.
              </Step>
              <Step>
                For the terminal setup you need Node.js 18 or newer. Check with <code>node -v</code>; if it&apos;s missing, install it from nodejs.org.
              </Step>
            </Steps>
          </Section>

          <Section id="quick" icon={<Wrench size={20} weight="bold" />} title="Quick setup" kind="Recommended">
            <p className="mt-4 leading-relaxed text-muted">
              This connects everything it finds on your computer at once: VS Code, Cursor and Windsurf (the extension), and Claude Code, Codex and Cursor&apos;s agent (the hooks).
            </p>
            <Steps>
              <Step>
                Install the Ember CLI with your package manager:
                <Cmd>npm install -g embertime</Cmd>
                <p className="mt-2 text-sm">Using bun or pnpm? <code>bun add -g embertime</code> or <code>pnpm add -g embertime</code>.</p>
              </Step>
              <Step>
                Connect everything, replacing <b>YOUR_KEY</b> with your key:
                <Cmd>{setupCmd}</Cmd>
              </Step>
              <Step>That&apos;s it. Write some code, and within about 30 seconds your time shows up on your dashboard.</Step>
            </Steps>
            <p className="mt-5 text-sm text-muted">
              Rather not install anything globally? Run it once with <code className="num rounded bg-surface-2 px-1 text-[13px] text-text">npx embertime setup --key YOUR_KEY{api}</code>.
            </p>
          </Section>

          <Section id="vscode" icon={<Code size={20} weight="bold" />} title="VS Code" kind="Editor">
            <Steps>
              <Step>
                Open the Extensions view (<Kbd>⇧⌘X</Kbd> on Mac, <Kbd>Ctrl+Shift+X</Kbd> on Windows/Linux), search <b>Ember</b> and install <b>Ember: Coding Time Tracker</b>. Or from a terminal:
                <Cmd>{`code --install-extension ${EXTENSION}`}</Cmd>
              </Step>
              <Step>
                Open the command palette (<Kbd>⇧⌘P</Kbd> / <Kbd>Ctrl+Shift+P</Kbd>), run <b>Ember: Set API Key</b> and paste your key.
              </Step>
              <Step>A flame with today&apos;s time appears in the status bar. Click it to open your dashboard.</Step>
            </Steps>
          </Section>

          <Section id="cursor" icon={<CursorMark size={18} />} title="Cursor" kind="Editor">
            <Steps>
              <Step>
                In Cursor, open Extensions (<Kbd>⇧⌘X</Kbd>), search <b>Ember</b> and install it. Cursor gets it from Open VSX. Or:
                <Cmd>{`cursor --install-extension ${EXTENSION}`}</Cmd>
              </Step>
              <Step>Run <b>Ember: Set API Key</b> from the command palette and paste your key.</Step>
              <Step>
                Want Cursor&apos;s AI agent counted too? See <a href="#cursor-agent" className="font-medium text-accent-text hover:underline">Cursor Agent</a> below.
              </Step>
            </Steps>
          </Section>

          <Section id="windsurf" icon={<WindsurfMark size={18} />} title="Windsurf" kind="Editor">
            <Steps>
              <Step>
                Open Extensions, search <b>Ember</b> and install it. Or:
                <Cmd>{`windsurf --install-extension ${EXTENSION}`}</Cmd>
              </Step>
              <Step>Run <b>Ember: Set API Key</b> from the command palette and paste your key.</Step>
            </Steps>
          </Section>

          <Section id="claude" icon={<ClaudeMark size={18} />} title="Claude Code" kind="AI agent">
            <Steps>
              <Step>
                Run the quick setup. It adds Ember&apos;s hooks to <code>~/.claude/settings.json</code> and backs up the file first:
                <Cmd>{setupCmd}</Cmd>
              </Step>
              <Step>Start a new Claude Code session. Prompts, edits and replies now count as AI time for the project you&apos;re in.</Step>
            </Steps>
          </Section>

          <Section id="codex" icon={<OpenAiLogo size={20} weight="bold" />} title="Codex" kind="AI agent">
            <Steps>
              <Step>
                Run the quick setup. It adds Ember&apos;s hooks to <code>~/.codex/hooks.json</code>:
                <Cmd>{setupCmd}</Cmd>
              </Step>
              <Step>
                Open Codex and type <b>/hooks</b>, then trust the Ember entries. Codex only runs hooks you&apos;ve trusted, so this step is required once.
              </Step>
            </Steps>
          </Section>

          <Section id="cursor-agent" icon={<TerminalWindow size={20} weight="bold" />} title="Cursor Agent" kind="AI agent">
            <Steps>
              <Step>
                Run the quick setup. It adds Ember&apos;s hooks to <code>~/.cursor/hooks.json</code>, next to any hooks you already have:
                <Cmd>{setupCmd}</Cmd>
              </Step>
              <Step>Restart Cursor. Work the agent does (prompts and file edits) now counts as AI time, separate from your own typing.</Step>
            </Steps>
          </Section>

          <Section id="check" icon={<CheckCircle size={20} weight="bold" />} title="Check it works">
            <Steps>
              <Step>
                See what&apos;s connected, today&apos;s time and anything waiting to sync:
                <Cmd>embertime status</Cmd>
              </Step>
              <Step>
                On your <Link href="/dashboard" className="font-medium text-accent-text hover:underline">dashboard</Link>, <b>Your tools</b> shows each editor and agent with when it was last seen.
              </Step>
            </Steps>
          </Section>

          <section id="help" className="scroll-mt-28 rounded-3xl border border-line p-6 sm:p-8">
            <h2 className="font-display text-2xl font-medium tracking-tight">Troubleshooting</h2>
            <dl className="mt-5 grid gap-5 text-muted [&_b]:text-text [&_code]:num [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:text-[13px] [&_code]:text-text [&_dt]:font-medium [&_dt]:text-text">
              <div>
                <dt>&ldquo;command not found: embertime&rdquo;</dt>
                <dd className="mt-1">Your global npm folder isn&apos;t on your PATH. Use <code>npx embertime setup --key YOUR_KEY</code> instead; it does the same thing.</dd>
              </div>
              <div>
                <dt>&ldquo;The server rejected that key&rdquo;</dt>
                <dd className="mt-1">The key was regenerated or mistyped. Create a new one in Settings and run setup again.</dd>
              </div>
              <div>
                <dt>Codex isn&apos;t showing up</dt>
                <dd className="mt-1">Open Codex, run <b>/hooks</b> and trust the Ember entries.</dd>
              </div>
              <div>
                <dt>I installed a new editor or agent later</dt>
                <dd className="mt-1">Run <code>embertime setup</code> again. It&apos;s safe to repeat and only adds what&apos;s missing.</dd>
              </div>
              <div>
                <dt>Remove Ember</dt>
                <dd className="mt-1"><code>embertime uninstall</code> removes the hooks and extension. Add <code>--purge</code> to delete local data too.</dd>
              </div>
            </dl>
            <p className="mt-6 text-sm text-muted">
              Ember records when and in which project you code, never your code or prompts. <Link href="/privacy" className="font-medium text-accent-text hover:underline">Privacy policy</Link>.
            </p>
          </section>

          {!user && (
            <div className="rounded-3xl border border-accent/30 bg-accent-soft p-6 text-center sm:p-8">
              <p className="font-display text-2xl font-medium tracking-tight">Ready? Start with your API key.</p>
              <Link href="/login" className={`${btn.primary} mt-5`}>Sign in to get your key</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
