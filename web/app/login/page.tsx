import Link from "next/link";
import { redirect } from "next/navigation";
import { GithubLogo, GoogleLogo, Info, XLogo } from "@phosphor-icons/react/ssr";
import { currentUser } from "@/lib/auth.ts";
import { all } from "@/lib/db.ts";
import { devLoginEnabled, providerConfigured } from "@/lib/oauth.ts";
import { TzCookie } from "@/components/TzCookie.tsx";
import { btn } from "@/components/ui.tsx";

export const metadata = { title: "Sign in" };

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

  return (
    <div className="mx-auto grid max-w-[420px] px-5 py-14 sm:py-20">
      <TzCookie />
      <div className="rise rounded-3xl border border-line bg-surface p-7 shadow-card sm:p-9">
        <h1 className="font-display text-3xl font-medium tracking-tight">Sign in to Ember</h1>
        <p className="mt-2 text-muted">New here? Your account is created the first time you continue.</p>

        <div className="mt-8 grid gap-3">
          <a href="/api/auth/github" className={`${btn.primary} py-3.5`}>
            <GithubLogo size={18} weight="bold" /> Continue with GitHub
          </a>
          <a href="/api/auth/google" className={`${btn.secondary} py-3.5`}>
            <GoogleLogo size={18} weight="bold" /> Continue with Google
          </a>
          {x && (
            <a href="/api/auth/x" className={`${btn.secondary} py-3.5`}>
              <XLogo size={18} weight="bold" /> Continue with X
            </a>
          )}
        </div>

        {sp.error && ERRORS[sp.error] && (
          <p role="alert" className="mt-5 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{ERRORS[sp.error]}</p>
        )}

        {(missing || !github || !google) && (
          <div className="mt-5 flex gap-3 rounded-2xl bg-surface-2 p-4 text-sm text-muted">
            <Info size={18} className="mt-0.5 shrink-0" />
            <p>
              {missing ? `${missing} sign-in isn't set up on this server yet.` : `Not set up yet: ${[!github && "GitHub", !google && "Google"].filter(Boolean).join(" and ")}.`}{" "}
              Add the client id and secret to <code className="num text-text">.env.local</code> (see <code className="num text-text">.env.example</code>) and restart.
            </p>
          </div>
        )}

        <p className="mt-6 text-xs leading-relaxed text-faint">
          We read your name, photo and public username. We never post or change anything. Connect X later in Settings to show a verified X handle on the leaderboard.
        </p>
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
