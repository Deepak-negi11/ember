import { redirect } from "next/navigation";
import { CheckCircle, GithubLogo, GoogleLogo, XLogo } from "@phosphor-icons/react/ssr";
import { apiKeyInfo, currentUser } from "@/lib/auth.ts";
import { linkedAccounts } from "@/lib/accounts.ts";
import { providerConfigured } from "@/lib/oauth.ts";
import { publicOrigin } from "@/lib/origin.ts";
import { ApiKeyPanel, ProfileForm } from "@/components/SettingsForms.tsx";
import { SetupTabs } from "@/components/SetupTabs.tsx";
import { YourTools } from "@/components/YourTools.tsx";
import { Card, btn } from "@/components/ui.tsx";

export const metadata = { title: "Settings", robots: { index: false } };

function ago(sec: number) {
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 90) return "just now";
  if (d < 5400) return `${Math.round(d / 60)} minutes ago`;
  if (d < 129600) return `${Math.round(d / 3600)} hours ago`;
  return `${Math.round(d / 86400)} days ago`;
}

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  const key = await apiKeyInfo(user.id);
  const accounts = await linkedAccounts(user.id);
  const xAccount = accounts.find((a) => a.provider === "x");
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(user.timezone)) zones.unshift(user.timezone);

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10 sm:px-6 sm:py-14">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">Settings</h1>
          {user.email ? <p className="mt-1 text-muted">Signed in as {user.email}</p> : null}
        </div>
      </div>

      {sp.welcome && (
        <div className="rise rounded-3xl border border-line bg-surface-2/70 p-6">
          <p className="font-display text-xl font-medium tracking-tight">Welcome to Ember, {user.display_name.split(" ")[0]}.</p>
          <p className="mt-1 text-muted">Create your API key below and connect an editor. Your heatmap starts with the first heartbeat.</p>
        </div>
      )}

      <Card className="rise p-6 sm:p-8" style={{ ["--d" as string]: 1 }}>
        <h2 id="api-key" className="scroll-mt-24 font-display text-xl font-medium tracking-tight">API key</h2>
        <p className="mb-5 mt-1 text-sm text-muted">
          Collectors use this key to send activity. Only a hash is stored, so the full key is shown once when you create it.
        </p>
        <ApiKeyPanel hint={key?.hint ?? null} lastUsed={key?.last_used_at ? ago(key.last_used_at) : null} />
        <div className="mt-8 border-t border-line pt-6">
          <h3 className="mb-4 font-medium">Connect your tools</h3>
          <SetupTabs origin={await publicOrigin()} keyHint={key?.hint ?? null} />
        </div>
        <div className="mt-8 border-t border-line pt-6">
          <YourTools userId={user.id} timezone={user.timezone} />
        </div>
      </Card>

      <Card className="rise p-6 sm:p-8" style={{ ["--d" as string]: 2 }}>
        <h2 id="accounts" className="scroll-mt-24 font-display text-xl font-medium tracking-tight">Connected accounts</h2>
        <p className="mb-5 mt-1 text-sm text-muted">Sign in with either. Connecting X verifies the handle shown on your profile and the leaderboard.</p>
        {sp.linked && <p role="status" className="mb-4 text-sm font-medium text-accent-text">{{ x: "X", google: "Google", github: "GitHub" }[sp.linked] ?? "Account"} connected.</p>}
        {sp.link_error && <p role="alert" className="mb-4 text-sm text-danger">That {{ x: "X", google: "Google", github: "GitHub" }[sp.link_error] ?? "That"} account already belongs to another Ember user.</p>}
        <ul className="grid gap-3">
          {(["github", "google", "x"] as const).map((p) => {
            const acct = accounts.find((a) => a.provider === p);
            const Icon = { github: GithubLogo, google: GoogleLogo, x: XLogo }[p];
            return (
              <li key={p} className="flex items-center gap-4 rounded-2xl border border-line p-4">
                <span className="grid size-10 place-items-center rounded-xl bg-surface-2"><Icon size={20} weight="bold" /></span>
                <span className="flex-1">
                  <span className="block font-medium">{{ github: "GitHub", google: "Google", x: "X" }[p]}</span>
                  <span className="block text-sm text-muted">
                    {acct ? (acct.handle ? `@${acct.handle}` : "Connected") : providerConfigured(p) ? "Not connected" : "Not set up on this server"}
                  </span>
                </span>
                {acct ? (
                  <CheckCircle size={22} weight="fill" className="text-accent" aria-label="Connected" />
                ) : providerConfigured(p) ? (
                  <a href={`/api/auth/${p}?link=1`} className={btn.small}>Connect</a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="rise p-6 sm:p-8" style={{ ["--d" as string]: 3 }}>
        <h2 className="mb-5 font-display text-xl font-medium tracking-tight">Profile</h2>
        <ProfileForm user={user} zones={zones} xHandle={xAccount?.handle ?? null} githubHandle={accounts.find((a) => a.provider === "github")?.handle ?? null} />
      </Card>
    </div>
  );
}
