import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarBlank, GithubLogo, Globe, MapPin, PencilSimple, Trophy, XLogo } from "@phosphor-icons/react/ssr";
import { currentUser, userByUsername } from "@/lib/auth.ts";
import { breakdown, rankOf, summary, todayFor } from "@/lib/stats.ts";
import { addDays, formatDuration } from "@/lib/time.ts";
import { SITE_URL } from "@/lib/site.ts";
import { JsonLd } from "@/components/JsonLd.tsx";
import { ProfileStats, parseRange } from "@/components/ProfileStats.tsx";
import { Avatar, Card } from "@/components/ui.tsx";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const u = await userByUsername(username);
  if (!u) return { title: "Not found", robots: { index: false } };
  const today = todayFor(u.timezone);
  const [s, langs] = await Promise.all([summary(u.id, u.timezone), breakdown(u.id, "language", addDays(today, -29), today, 3)]);
  const parts = [`${formatDuration(s.year)} of coding in the last year`];
  if (langs.length) parts.push(`mostly ${langs.map((l) => l.name).join(", ")}`);
  if (s.streak.current > 1) parts.push(`${s.streak.current}-day streak`);
  const description = `${u.display_name}'s coding activity on Ember: ${parts.join(", ")}.${u.bio ? ` ${u.bio}` : ""}`.slice(0, 300);
  const title = `${u.display_name} (@${u.username})`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${u.username}` },
    openGraph: { type: "profile", title, description, url: `/u/${u.username}`, username: u.username },
    twitter: { card: "summary_large_image", title, description, creator: u.twitter ? `@${u.twitter}` : undefined },
  };
}

export default async function Profile({ params, searchParams }: Props) {
  const { username } = await params;
  const user = await userByUsername(username);
  if (!user) notFound();
  const viewer = await currentUser();
  const owner = viewer?.id === user.id;
  const range = parseRange((await searchParams).range);
  const rank = await rankOf(user.id, 7);
  const joined = new Date(user.created_at * 1000).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const sameAs = [
    user.github && `https://github.com/${user.github}`,
    user.twitter && `https://x.com/${user.twitter}`,
    user.website,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          url: `${SITE_URL}/u/${user.username}`,
          dateCreated: new Date(user.created_at * 1000).toISOString(),
          mainEntity: {
            "@type": "Person",
            name: user.display_name,
            alternateName: `@${user.username}`,
            ...(user.bio ? { description: user.bio } : {}),
            ...(user.avatar_url ? { image: user.avatar_url } : {}),
            ...(user.location ? { homeLocation: { "@type": "Place", name: user.location } } : {}),
            ...(sameAs.length ? { sameAs } : {}),
          },
        }}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="rise lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <Avatar name={user.display_name} src={user.avatar_url} size={88} />
            <h1 className="mt-4 break-words font-display text-3xl font-medium tracking-tight">{user.display_name}</h1>
            <p className="text-muted">@{user.username}</p>
            {owner && (
              <Link href="/profile" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline">
                <PencilSimple size={14} /> Edit profile
              </Link>
            )}

            {rank && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent-text">
                <Trophy size={15} weight="fill" />
                <span className="num font-semibold">#{rank.rank}</span> this week
              </div>
            )}

            {user.bio && <p className="mt-4 break-words leading-relaxed">{user.bio}</p>}

            {user.quote && (
              <blockquote className="mt-5 break-words border-l-2 border-accent pl-4 text-[15px] italic leading-relaxed text-muted">
                &ldquo;{user.quote}&rdquo;
              </blockquote>
            )}

            <ul className="mt-5 grid gap-2.5 text-sm text-muted">
              {user.location && (
                <li className="flex items-center gap-2"><MapPin size={16} /> {user.location}</li>
              )}
              {user.twitter && (
                <li>
                  <a href={`https://x.com/${user.twitter}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 hover:text-text">
                    <XLogo size={16} /> @{user.twitter}
                  </a>
                </li>
              )}
              {user.github && (
                <li>
                  <a href={`https://github.com/${user.github}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 hover:text-text">
                    <GithubLogo size={16} /> {user.github}
                  </a>
                </li>
              )}
              {user.website && (
                <li>
                  <a href={user.website} target="_blank" rel="noopener noreferrer nofollow ugc" className="flex items-center gap-2 truncate hover:text-text">
                    <Globe size={16} /> {user.website.replace(/^https:\/\//, "")}
                  </a>
                </li>
              )}
              <li className="flex items-center gap-2"><CalendarBlank size={16} /> Joined {joined}</li>
            </ul>
          </Card>
        </aside>

        <ProfileStats user={user} range={range} owner={owner} basePath={`/u/${user.username}`} />
      </div>
    </div>
  );
}
