// AI token usage sent by the agent hook: parsing and estimated cost. No database
// access here so it is easy to unit test (see stats.ts for storage).

export interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface ParsedUsage extends TokenCounts {
  /** Opaque 40-hex id from the hook; a retried send repeats it and is ignored. */
  id: string;
  time: number;
  agent: string;
  model: string;
}

const MAX_AGE_SEC = 365 * 24 * 3600;
const MAX_SKEW_SEC = 300;
/** One record covers at most a few MB of transcript; anything bigger is junk or abuse. */
const MAX_TOKENS_PER_RECORD = 200_000_000;

const ID_RE = /^[a-f0-9]{40}$/;
const AGENT_RE = /^[a-z0-9-]{1,24}$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const FIELDS = ["input", "output", "cache_read", "cache_write"] as const;

export function parseUsage(raw: unknown, now: number): ParsedUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) return null;
  if (typeof r.time !== "number" || !Number.isFinite(r.time)) return null;
  const time = Math.floor(r.time);
  if (time > now + MAX_SKEW_SEC || time < now - MAX_AGE_SEC) return null;
  const agent = typeof r.agent === "string" ? r.agent.toLowerCase() : "";
  if (!AGENT_RE.test(agent)) return null;
  const model = typeof r.model === "string" ? r.model.toLowerCase() : "";
  if (!MODEL_RE.test(model)) return null;

  const counts = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const f of FIELDS) {
    const v = r[f] ?? 0;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
    counts[f] = v;
  }
  const total = totalTokens(counts);
  if (total === 0 || total > MAX_TOKENS_PER_RECORD) return null;
  return { id: r.id, time, agent, model, ...counts };
}

export function totalTokens(c: TokenCounts): number {
  return c.input + c.output + c.cache_read + c.cache_write;
}

/** USD per million tokens. Cache writes are billed like input where a provider has no write price. */
interface Price { input: number; output: number; cache_read: number; cache_write: number }

const claude = (input: number, output: number, cacheRead: number): Price => ({ input, output, cache_read: cacheRead, cache_write: input * 1.25 });
const openai = (input: number, cached: number, output: number): Price => ({ input, output, cache_read: cached, cache_write: input });

/**
 * Standard API list prices (short context, 5-minute cache writes), checked
 * October 2026 against Anthropic's model docs and OpenAI's pricing page.
 * Subscriptions (Claude Max, ChatGPT plans) bill differently, so this is
 * "what the tokens would cost on the API", not what anyone was charged.
 * Keys match a model id exactly or as a prefix followed by "-" (date suffixes,
 * "-codex" variants); the longest key wins.
 */
export const PRICES: Record<string, Price> = {
  "claude-fable-5-1": claude(10, 50, 0.25),
  "claude-mythos-5-1": claude(10, 50, 0.25),
  "claude-fable-5": claude(10, 50, 1),
  "claude-mythos-5": claude(10, 50, 1),
  "claude-opus-5-5": claude(4, 20, 0.2),
  "claude-opus-5": claude(5, 25, 0.5),
  "claude-opus-4-8": claude(5, 25, 0.5),
  "claude-opus-4-7": claude(5, 25, 0.5),
  "claude-opus-4-6": claude(5, 25, 0.5),
  "claude-opus-4-5": claude(5, 25, 0.5),
  "claude-opus-4-1": claude(15, 75, 1.5),
  "claude-opus-4": claude(15, 75, 1.5),
  "claude-sonnet-5-5": claude(2, 10, 0.2),
  "claude-sonnet-5": claude(2, 10, 0.2),
  "claude-sonnet-4-6": claude(3, 15, 0.3),
  "claude-sonnet-4-5": claude(3, 15, 0.3),
  "claude-sonnet-4": claude(3, 15, 0.3),
  "claude-haiku-5-5": claude(0.1, 0.5, 0.01),
  "claude-haiku-4-5": claude(1, 5, 0.1),
  "gpt-6-astra": openai(10, 1, 50),
  "gpt-6.1-sol": openai(2, 0.1, 10),
  "gpt-6-sol": openai(2, 0.2, 10),
  "gpt-6-luna": openai(0.1, 0.01, 0.5),
  "gpt-5.6-sol": openai(4, 0.4, 20),
  "gpt-5.6-terra": openai(2, 0.2, 12),
  "gpt-5.6-luna": openai(0.2, 0.02, 1.2),
  "gpt-5.5-pro": openai(30, 30, 180),
  "gpt-5.5": openai(5, 0.5, 30),
  "gpt-5.4-pro": openai(30, 30, 180),
  "gpt-5.4-mini": openai(0.75, 0.075, 4.5),
  "gpt-5.4-nano": openai(0.2, 0.02, 1.25),
  "gpt-5.4": openai(2.5, 0.25, 15),
  "gpt-5.3-codex": openai(1.75, 0.175, 14),
  "gpt-5.2-pro": openai(21, 21, 168),
  "gpt-5.2": openai(1.75, 0.175, 14),
  "gpt-5.1": openai(1.25, 0.125, 10),
  "gpt-5-pro": openai(15, 15, 120),
  "gpt-5-mini": openai(0.25, 0.025, 2),
  "gpt-5-nano": openai(0.05, 0.005, 0.4),
  "gpt-5": openai(1.25, 0.125, 10),
};

const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

export function priceFor(model: string): Price | undefined {
  const key = KEYS.find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key] : undefined;
}

/**
 * Estimated cost in micro-dollars. With prices per million tokens, tokens x price
 * is already in millionths of a dollar. Unknown models cost 0 (shown as unpriced).
 */
export function costMicros(model: string, c: TokenCounts): number {
  const p = priceFor(model);
  if (!p) return 0;
  return Math.round(c.input * p.input + c.output * p.output + c.cache_read * p.cache_read + c.cache_write * p.cache_write);
}

/** "1.2B", "34.5M", "812K", "950". */
export function formatTokens(n: number): string {
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return String(Math.round(n));
}

/** "$1,234", "$12.40", "$0.03", "<$0.01", "$0". */
export function formatCost(micros: number): string {
  const usd = micros / 1e6;
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  return `$${usd.toFixed(2)}`;
}

/** Display names for common model ids; anything else is shown as sent. */
export function modelName(model: string): string {
  const claudeM = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d))?(?:-|$)/.exec(model);
  if (claudeM) {
    const [, family, major, minor] = claudeM;
    return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
  }
  const gpt = /^gpt-([\d.]+)(-[a-z]+)?/.exec(model);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].slice(1)[0].toUpperCase()}${gpt[2].slice(2)}` : ""}`;
  return model;
}
