// Parse untrusted heartbeat payloads into a strict internal shape.
// Anything that does not fit is rejected per item, never coerced silently.

export interface ParsedHeartbeat {
  time: number;
  project: string;
  language: string;
  branch: string;
  editor: string;
  category: "coding" | "ai";
  is_write: boolean;
  stack: string[];
  entity: string;
}

export const MAX_BATCH = 500;
const MAX_AGE_SEC = 365 * 24 * 3600;
const MAX_SKEW_SEC = 300;

const EDITOR_RE = /^[a-z0-9-]{1,24}$/;
const ENTITY_RE = /^[a-f0-9]{40}$/;

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Drop control characters, collapse whitespace.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  if (!s || s.length > max) return null;
  return s;
}

export function parseHeartbeat(raw: unknown, now: number): ParsedHeartbeat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.time !== "number" || !Number.isFinite(r.time)) return null;
  const time = Math.floor(r.time);
  if (time > now + MAX_SKEW_SEC || time < now - MAX_AGE_SEC) return null;

  const project = cleanText(r.project, 120);
  if (!project) return null;

  const editor = typeof r.editor === "string" ? r.editor.toLowerCase() : "";
  if (!EDITOR_RE.test(editor)) return null;

  if (r.category !== "coding" && r.category !== "ai") return null;

  const language = (r.language === undefined ? "Other" : cleanText(r.language, 40)) ?? "Other";
  const branch = (r.branch === undefined ? "" : cleanText(r.branch, 120)) ?? "";
  const entity = typeof r.entity === "string" && ENTITY_RE.test(r.entity) ? r.entity : "";

  const stack: string[] = [];
  if (Array.isArray(r.stack)) {
    for (const s of r.stack.slice(0, 24)) {
      const t = cleanText(s, 32);
      if (t && !stack.includes(t)) stack.push(t);
    }
  }

  return { time, project, language, branch, editor, category: r.category, is_write: r.is_write === true, stack, entity };
}
