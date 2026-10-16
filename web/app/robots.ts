import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site.ts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/settings", "/profile", "/leaderboard"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
