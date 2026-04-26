/**
 * Best-effort sanitization for LLM/CLI diagnostic strings shown in API
 * responses, log lines, and the "Detalles" modal.
 *
 * Goal: never leak `CLAUDE_CODE_OAUTH_TOKEN`, `OPENROUTER_API_KEY`, the
 * contents of `~/.claude/.credentials.json`, JWT-shaped strings, or
 * Authorization headers — even if the upstream CLI happens to print them.
 *
 * This is an authoring-time safety net. Authoritative redaction still
 * lives in `errors.ts > sanitizeErrorMessage` for short string details,
 * but `sanitize()` accepts long multi-line strings (stdout/stderr tails)
 * and applies a broader pattern set without truncating to 300 chars.
 */

import { getSystemConfig } from "@/lib/system-config/loader";

const REDACTED = "[redacted]";

// Regular expressions ordered roughly by specificity → generality.
// Each captures one occurrence; `replaceAll` semantics rely on `g` flag.
const PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // OAuth bearer tokens (Authorization: Bearer xxx, with or without quotes).
  { re: /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, replacement: "Bearer " + REDACTED },
  // Authorization header values (after :)
  { re: /\bAuthorization\s*:\s*[^\s",]+/gi, replacement: "Authorization: " + REDACTED },
  // OpenAI / OpenRouter style keys: sk-... (>= 20 chars).
  { re: /\bsk-[A-Za-z0-9_\-]{16,}/g, replacement: REDACTED },
  // Anthropic CLI long-lived OAuth tokens often start with `sk-ant-`.
  { re: /\bsk-ant-[A-Za-z0-9_\-]{8,}/g, replacement: REDACTED },
  // JWT-shaped strings: 3 base64url segments separated by `.`, each at least 8 chars.
  { re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, replacement: REDACTED },
  // PostgreSQL DSN.
  { re: /postgres(?:ql)?:\/\/[^\s'"<>]*/gi, replacement: "postgres://" + REDACTED },
  // user:pass@host pattern (covers DSN-style basic auth too).
  { re: /:[^@\s'"]+@/g, replacement: ":" + REDACTED + "@" },
  // password=... (query string / log dump form).
  { re: /password\s*=\s*[^\s&'"]+/gi, replacement: "password=" + REDACTED },
  // refresh_token / access_token JSON values.
  { re: /"(?:refresh_token|access_token|refreshToken|accessToken)"\s*:\s*"[^"]*"/g, replacement: '"$&": "[redacted]"' },
];

/**
 * Build the runtime list of sensitive env-var literal values to scrub.
 *
 * We pull the live values for every key marked `sensitive: true` in
 * `config/schema.yaml` and strip any non-empty value from the input.
 * If the loader fails (tests, config missing), we silently fall back
 * to the regex-only pass.
 */
function getSensitiveLiterals(): string[] {
  try {
    const cfg = getSystemConfig();
    const out: string[] = [];
    for (const v of Object.values(cfg)) {
      if (!v.sensitive) continue;
      const raw = v.value;
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      // Avoid scrubbing trivially short / placeholder values that would
      // create huge collateral damage on the redacted output.
      if (trimmed.length >= 8) out.push(trimmed);
    }
    return out;
  } catch {
    return [];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize a free-form diagnostic string. Returns a new string with
 * known-secret patterns replaced by `[redacted]`. Idempotent: running
 * twice yields the same output.
 */
export function sanitize(input: string | null | undefined): string {
  if (!input) return "";
  let out = String(input);
  for (const { re, replacement } of PATTERNS) {
    out = out.replace(re, replacement);
  }
  for (const literal of getSensitiveLiterals()) {
    if (!literal) continue;
    out = out.replace(new RegExp(escapeRegExp(literal), "g"), REDACTED);
  }
  return out;
}

/**
 * Sanitize then keep the trailing `maxBytes` (UTF-8). Useful for stderr
 * tails — the recent end of the buffer is usually where the actual
 * failure shows up.
 */
export function sanitizeTail(input: string | null | undefined, maxBytes: number): string {
  const cleaned = sanitize(input);
  if (cleaned.length <= maxBytes) return cleaned;
  // Trim to the last maxBytes characters; we don't byte-count here as
  // diagnostic strings are virtually always single-byte ASCII / latin1.
  return cleaned.slice(cleaned.length - maxBytes);
}

/**
 * Sanitize an argv array for display. Hides values right after flags
 * known to carry credentials (e.g. `--api-key`, `--token`).
 */
const FLAG_VALUE_REDACT = new Set([
  "--api-key",
  "--token",
  "--auth-token",
  "--bearer",
  "--password",
  "--secret",
]);

export function sanitizeArgv(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    out.push(sanitize(a));
    if (FLAG_VALUE_REDACT.has(a) && i + 1 < argv.length) {
      out.push(REDACTED);
      i += 1;
    }
  }
  return out;
}
