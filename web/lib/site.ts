// Public site identity, used for SEO metadata, the sitemap and share images.
export const SITE_URL = (process.env.EMBER_URL || "https://ember-dev.vercel.app").replace(/\/$/, "");
export const SITE_NAME = "Ember";
export const SITE_TAGLINE = "Coding time tracker for VS Code, Cursor, Claude Code and Codex";
export const SITE_DESCRIPTION =
  "Ember tracks your coding time in VS Code, Cursor, Windsurf, Claude Code, Codex and Cursor Agent, and turns it into a GitHub-style heatmap, language stats and a weekly developer leaderboard. Free, private, never reads your code.";
export const SITE_KEYWORDS = [
  "coding time tracker",
  "WakaTime alternative",
  "VS Code time tracking",
  "Cursor time tracking",
  "Claude Code stats",
  "Codex usage",
  "developer leaderboard",
  "coding heatmap",
  "programming stats",
  "developer productivity",
];
