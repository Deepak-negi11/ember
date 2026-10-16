import type { MetadataRoute } from "next";
import { all } from "@/lib/db.ts";
import { SITE_URL } from "@/lib/site.ts";

// Regenerated at most once an hour, so crawlers don't hit the database on every fetch.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  // Public profiles of everyone active in the last year, most recently active first.
  const profiles = await all<{ username: string; last: string }>(
    `SELECT u.username, MAX(s.date) AS last FROM users u JOIN daily_stats s ON s.user_id = u.id
      WHERE s.date >= date('now', '-365 days') GROUP BY u.id ORDER BY last DESC LIMIT 5000`,
  );
  for (const p of profiles) {
    pages.push({ url: `${SITE_URL}/u/${encodeURIComponent(p.username)}`, lastModified: new Date(`${p.last}T23:59:59Z`), changeFrequency: "daily", priority: 0.6 });
  }
  return pages;
}
