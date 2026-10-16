import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Fire } from "@phosphor-icons/react/ssr";
import { currentUser } from "@/lib/auth.ts";
import { todayFor } from "@/lib/stats.ts";
import { addDays } from "@/lib/time.ts";
import { Heatmap, type HeatCell } from "@/components/Heatmap.tsx";
import { Community, SAMPLE_WEEK } from "@/components/Community.tsx";
import { Label, btn } from "@/components/ui.tsx";
import { JsonLd } from "@/components/JsonLd.tsx";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site.ts";

/** Deterministic sample year for an empty install, clearly labelled in the UI. */
function sampleYear(end: string): HeatCell[] {
  const out: HeatCell[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 365; i++) {
    const date = addDays(end, -i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const busy = (dow === 0 || dow === 6 ? 0.35 : 0.8) * (0.6 + 0.4 * Math.sin(i / 40));
    if (rand() < busy) out.push({ date, seconds: Math.round(rand() * rand() * 6 * 3600), ai_seconds: Math.round(rand() * 1800) });
  }
  return out;
}

function SectionHead({ label, title, sub }: { label?: string; title: string; sub: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-14">
      {label && <Label>{label}</Label>}
      <h2 className="mt-4 font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">{title}</h2>
      <p className="mx-auto mt-4 max-w-[52ch] text-lg leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

export default async function Home() {
  // Signed-in people go straight to the leaderboard; the landing page is the same for every visitor.
  if (await currentUser()) redirect("/leaderboard");
  const end = todayFor("UTC");
  const cells = sampleYear(end);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, description: SITE_DESCRIPTION },
            {
              "@type": "SoftwareApplication",
              name: SITE_NAME,
              url: SITE_URL,
              description: SITE_DESCRIPTION,
              applicationCategory: "DeveloperApplication",
              operatingSystem: "macOS, Windows, Linux",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            },
          ],
        }}
      />
      {/* Hero */}
      <section className="relative overflow-x-clip">
        <div aria-hidden className="ember-pool absolute left-1/2 top-24 h-80 w-[46rem] max-w-full -translate-x-1/2" />
        <div className="relative mx-auto flex max-w-5xl flex-col items-center px-5 pb-28 pt-10 text-center sm:px-6 md:pb-36 md:pt-20">
          <Link
            href="/login"
            className="rise inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface/80 py-1.5 pl-2 pr-3.5 text-[13px] text-muted shadow-card backdrop-blur transition-colors hover:text-text sm:text-sm"
          >
            <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent">
              <Fire size={13} weight="fill" />
            </span>
            <span>
              Free coding time tracker for <span className="font-semibold text-text">editors and AI agents</span>
            </span>
            <ArrowRight size={13} />
          </Link>

          {/* Font scales with the viewport so the headline is always exactly two lines. */}
          <h1
            className="rise mt-8 font-display font-medium leading-[1.05] tracking-tight"
            style={{ ["--d" as string]: 1, fontSize: "clamp(26px, 8.4vw, 88px)" }}
          >
            <span className="block whitespace-nowrap">Proof you showed up,</span>
            <span className="block whitespace-nowrap">every single day.</span>
          </h1>

          <p className="rise mt-7 max-w-[52ch] text-lg leading-relaxed text-muted sm:text-xl" style={{ ["--d" as string]: 2 }}>
            Ember tracks time in VS Code, Cursor, Claude Code and Codex, and lights up your year one square at a time.
          </p>

          <div className="rise mt-10 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row" style={{ ["--d" as string]: 3 }}>
            <Link href="/login" className={btn.primary + " sm:px-7"}>
              Start tracking <ArrowRight size={16} weight="bold" />
            </Link>
            <Link href="/setup" className={btn.secondary + " sm:px-7"}>
              How to set up
            </Link>
          </div>
        </div>
      </section>

      {/* What your year looks like (sample data, never a real person's) */}
      <section id="heatmap" className="mx-auto max-w-6xl scroll-mt-28 px-5 pb-28 sm:px-6">
        <SectionHead
          label="Your heatmap"
          title="One square for every day you code"
          sub="The more you code, the brighter it glows. Hover any day to see the hours behind it."
        />
        <div className="rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-8">
          <Heatmap cells={cells} end={end} />
          <p className="mt-4 text-xs text-faint">Sample data. Yours fills in from your first coding session.</p>
        </div>
      </section>

      {/* Community view (sample data, the same for every visitor) */}
      <section id="community" className="scroll-mt-28 border-t border-line bg-surface-2/60">
        <div className="mx-auto max-w-6xl px-5 py-28 sm:px-6">
          <SectionHead label="Community" title="See how everyone codes" sub="When people code, the languages and stacks they use, and how much is hands-on versus AI agents." />
          <Community week={SAMPLE_WEEK} />
          <p className="mt-4 text-xs text-faint">Sample data. The real community view updates as developers join.</p>
        </div>
      </section>

      {/* Setup */}
      <section id="setup" className="scroll-mt-28 border-y border-line bg-surface-2/60">
        <div className="mx-auto max-w-6xl px-5 py-28 sm:px-6">
          <SectionHead label="Setup" title="Set up in three steps" sub="Works with VS Code, Cursor, Windsurf, Claude Code, Codex and Cursor Agent. About two minutes." />
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              { title: "Sign in", body: "Continue with GitHub or Google, then create your API key in Settings.", cmd: null },
              { title: "Install the CLI", body: "With npm, bun or pnpm. One install covers every editor and agent.", cmd: "npm install -g embertime" },
              { title: "Connect everything", body: "Paste your key. Ember finds your editors and agents and connects them.", cmd: "embertime setup --key YOUR_KEY" },
            ].map((step, i) => (
              <li key={step.title} className="flex flex-col rounded-3xl border border-line bg-surface p-6 shadow-card">
                <span className="num grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text">{i + 1}</span>
                <h3 className="mt-5 font-display text-xl font-medium tracking-tight">{step.title}</h3>
                <p className="mt-2 flex-1 leading-relaxed text-muted">{step.body}</p>
                {step.cmd && <code className="num mt-5 block rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-text">{step.cmd}</code>}
              </li>
            ))}
          </ol>
          <div className="mt-10 text-center">
            <Link href="/setup" className={btn.secondary}>
              Step-by-step guide for each tool <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="relative overflow-hidden border-t border-line">
        <div aria-hidden className="ember-pool absolute left-1/2 top-1/2 h-72 w-[42rem] max-w-full -translate-x-1/2 -translate-y-1/2" />
        <div className="relative mx-auto max-w-4xl px-5 py-28 text-center sm:px-6">
          <h2 className="font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
            Your first glowing square is <span className="text-accent">one save away.</span>
          </h2>
          <div className="mt-10">
            <Link href="/login" className={btn.primary}>
              Start tracking
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
