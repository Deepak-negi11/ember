import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import { currentUser } from "@/lib/auth.ts";
import { linkedAccounts } from "@/lib/accounts.ts";
import { ProfileForm } from "@/components/SettingsForms.tsx";
import { Card, btn } from "@/components/ui.tsx";

export const metadata = { title: "Edit profile", robots: { index: false } };

/** What other people see on your public page and the leaderboard. Account and key settings stay in Settings. */
export default async function EditProfile() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const accounts = await linkedAccounts(user.id);
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(user.timezone)) zones.unshift(user.timezone);

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10 sm:px-6 sm:py-14">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">Edit profile</h1>
          <p className="mt-1 text-muted">Shown on your public page and next to your name on the leaderboard.</p>
        </div>
        <Link href={`/u/${user.username}`} className={btn.secondary}>
          View profile <ArrowUpRight size={14} />
        </Link>
      </div>

      <Card className="rise p-6 sm:p-8" style={{ ["--d" as string]: 1 }}>
        <ProfileForm
          user={user}
          zones={zones}
          xHandle={accounts.find((a) => a.provider === "x")?.handle ?? null}
          githubHandle={accounts.find((a) => a.provider === "github")?.handle ?? null}
        />
      </Card>
    </div>
  );
}
