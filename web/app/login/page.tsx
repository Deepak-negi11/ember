import Link from "next/link";
import { redirect } from "next/navigation";
import { Fire, Info, LockSimple } from "@phosphor-icons/react/ssr";
import { GitHubMark, GoogleG, XMark } from "@/components/BrandIcons.tsx";
import { currentUser } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { devLoginEnabled, providerConfigured } from "@/lib/oauth.ts";
import { TzCookie } from "@/components/TzCookie.tsx";
import { btn } from "@/components/ui.tsx";

export const metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled. You can try again whenever you like.",
  expired: "That sign-in took too long. Please start again.",
  state: "We couldn't verify that sign-in request. Please start again.",
  oauth_failed: "The provider didn't complete the sign-in. Please try again in a moment.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  dev_unknown: "That user doesn't exist.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUser()) redirect("/dashboard");
  const sp = await searchParams;
  const x = providerConfigured("x");
  const google = providerConfigured("google");
  const github = providerConfigured("github");
  const dev = devLoginEnabled();
  const devUsers = dev ? await all<{ username: string; display_name: string }>("SELECT username, display_name FROM users ORDER BY created_at DESC LIMIT 25") : [];
  const missing = sp.error === "not_configured" ? (({ x: "X", google: "Google", github: "GitHub" } as Record<string, string>)[sp.provider ?? ""] ?? "That provider") : null;

  // The setup hint is for whoever runs the server, so it never shows in production.
  const isDev = process.env.NODE_ENV !== "production";
  const unconfigured = [!github && "GitHub", !google && "Google"].filter(Boolean) as string[];
  const providers = [
    github && { id: "github", label: "Continue with GitHub", icon: <GitHubMark size={20} />, primary: true },
    google && { id: "google", label: "Continue with Google", icon: <GoogleG size={20} />, primary: false },
    x && { id: "x", label: "Continue with X", icon: <XMark size={17} />, primary: false },
  ].filter(Boolean) as { id: string; label: string; icon: React.ReactNode; primary: boolean }[];
  // Locally, show every button even before keys exist, so the flow can be clicked through.
  const shown = isDev && providers.length === 0
    ? [
        { id: "github", label: "Continue with GitHub", icon: <GitHubMark size={20} />, primary: true },
        { id: "google", label: "Continue with Google", icon: <GoogleG size={20} />, primary: false },
      ]
    : providers;

  return (
    <div className="mx-auto grid max-w-[440px] px-5 py-12 sm:py-20">
      <TzCookie />
      <div className="rise rounded-3xl border border-line bg-surface p-7 shadow-card sm:p-9">
        <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Fire size={26} weight="fill" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-medium tracking-tight">Sign in to Ember</h1>
        <p className="mt-2 text-muted">New here? Your account is created the first time you continue.</p>

        {shown.length > 0 ? (
          <div className="mt-8 grid gap-3">
            {shown.map((p) => (
              <a key={p.id} href={`/api/auth/${p.id}`} className={`${p.primary ? btn.primary : btn.secondary} relative py-3.5`}>
                <span className="absolute left-4 grid place-items-center">{p.icon}</span>
                {p.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-8 rounded-2xl bg-surface-2 p-4 text-sm text-muted">Sign-in is being set up. Please check back in a little while.</p>
        )}

        {sp.error && ERRORS[sp.error] && (
          <p role="alert" className="mt-5 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{ERRORS[sp.error]}</p>
        )}
        {sp.error === "not_configured" && !isDev && (
          <p role="alert" className="mt-5 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {missing} sign-in isn&apos;t available right now. Please use another option.
          </p>
        )}

        {isDev && (missing || unconfigured.length > 0) && (
          <div className="mt-5 flex gap-3 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-muted">
            <Info size={18} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-medium text-text">Only visible on your computer.</span>{" "}
              {missing ? `${missing} sign-in isn't set up yet.` : `Not set up yet: ${unconfigured.join(" and ")}.`} Add its client id and secret to{" "}
              <code className="num text-text">.env.local</code> locally, or to Environment Variables on Vercel.
            </p>
          </div>
        )}

        <div className="mt-7 flex gap-2.5 border-t border-line pt-5 text-xs leading-relaxed text-faint">
          <LockSimple size={15} className="mt-px shrink-0" />
          <p>
            We only read your name, photo and username, and never post anything. By continuing, you agree to Ember&apos;s{" "}
            <Link href="/terms" className="font-medium text-muted underline underline-offset-2 hover:text-text">Terms of use</Link> and{" "}
            <Link href="/privacy" className="font-medium text-muted underline underline-offset-2 hover:text-text">Privacy policy</Link>.
          </p>
        </div>
      </div>

      {dev && devUsers.length > 0 && (
        <form action="/api/auth/dev" method="get" className="mt-5 rounded-2xl border border-dashed border-line-strong p-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Local development: sign in as</span>
            <span className="flex gap-2">
              <select name="u" className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2 text-text">
                {devUsers.map((u) => <option key={u.username} value={u.username}>{u.display_name} (@{u.username})</option>)}
              </select>
              <button className={btn.small}>Go</button>
            </span>
            <span className="text-xs text-faint">Shown because EMBER_DEV_LOGIN=1. Never available in production builds.</span>
          </label>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/" className="hover:text-text">Back to home</Link>
      </p>
    </div>
  );
}
