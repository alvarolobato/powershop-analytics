/**
 * Origin matcher for pg_stat_statements slow queries.
 *
 * Given the raw SQL text from pg_stat_statements, attempts to identify
 * where in the codebase the query was generated.  Matching is done by
 * extracting a "fingerprint" (set of ps_* table names referenced) from
 * both the candidate and the source SQL, then finding the best match.
 *
 * Priority order:
 *   1. dashboard/lib/templates/*.ts  (template widget SQL)
 *   2. Saved dashboards from the database (widget SQL in the spec JSON)
 *   3. dashboard/lib/review-queries.ts (REVIEW_QUERIES array)
 *   4. scripts/wren-push-metadata.py  (SQL_PAIRS list)
 *
 * Returns null when no source reaches the minimum similarity threshold.
 */

import { readFileSync } from "fs";
import path from "path";
import { TEMPLATES } from "@/lib/templates";
import { REVIEW_QUERIES } from "@/lib/review-queries";
import type { DashboardSpec } from "@/lib/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueryOrigin {
  /** Human-readable source label, e.g. "Template: Responsable de Ventas > Ventas Netas" */
  source: string;
  /** Relative file path hint when deterministic, e.g. "dashboard/lib/templates/ventas.ts" */
  locationHint?: string;
}

// ─── Fingerprinting ───────────────────────────────────────────────────────────

/**
 * Extract a normalised fingerprint from a SQL string:
 *   - lowercase the query
 *   - extract all ps_* table names referenced in FROM / JOIN clauses
 *   - return a sorted, deduplicated array of table names
 *
 * The fingerprint must be non-empty and contain at least one ps_* name;
 * otherwise we cannot make a reliable match.
 */
export function extractSqlFingerprint(sql: string): string[] {
  if (!sql) return [];
  // Match ps_<word> references (table names or aliases)
  const matches = sql.toLowerCase().match(/\bps_[a-z_]+/g) ?? [];
  return [...new Set(matches)].sort();
}

/**
 * Jaccard similarity between two fingerprint arrays.
 * Returns a number in [0, 1].  Returns 0 when both are empty.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Minimum Jaccard similarity to claim a match. */
const MIN_SIMILARITY = 0.5;

// ─── Source scanners ──────────────────────────────────────────────────────────

interface Candidate {
  source: string;
  locationHint?: string;
  fingerprint: string[];
}

/** Build candidates from templates. */
function templateCandidates(): Candidate[] {
  const results: Candidate[] = [];
  for (const tmpl of TEMPLATES) {
    const spec = tmpl.spec;
    const locationHint = `dashboard/lib/templates/${tmpl.slug}.ts`;
    for (const widget of spec.widgets) {
      const sqls: string[] = [];
      if ("sql" in widget && typeof widget.sql === "string") {
        sqls.push(widget.sql);
      }
      if ("items" in widget && Array.isArray(widget.items)) {
        for (const item of widget.items) {
          if (item && typeof item === "object" && "sql" in item && typeof item.sql === "string") {
            sqls.push(item.sql);
          }
        }
      }
      for (const sql of sqls) {
        const fp = extractSqlFingerprint(sql);
        if (fp.length > 0) {
          const widgetLabel =
            "title" in widget && widget.title
              ? String(widget.title)
              : "items" in widget
              ? "kpi_row"
              : widget.type ?? "widget";
          results.push({
            source: `Template: ${tmpl.name} > ${widgetLabel}`,
            locationHint,
            fingerprint: fp,
          });
        }
      }
    }
  }
  return results;
}

/** Build candidates from review queries. */
function reviewQueryCandidates(): Candidate[] {
  return REVIEW_QUERIES.filter((q) => extractSqlFingerprint(q.sql).length > 0).map((q) => ({
    source: `Review: ${q.name} (${q.domain})`,
    locationHint: "dashboard/lib/review-queries.ts",
    fingerprint: extractSqlFingerprint(q.sql),
  }));
}

/** Extract SQL strings from a raw dashboard spec JSON. */
function extractSpecSqls(specJson: unknown): string[] {
  const sqls: string[] = [];
  if (!specJson || typeof specJson !== "object") return sqls;
  const spec = specJson as DashboardSpec;
  if (!Array.isArray(spec.widgets)) return sqls;
  for (const widget of spec.widgets) {
    if ("sql" in widget && typeof widget.sql === "string") sqls.push(widget.sql);
    if ("items" in widget && Array.isArray(widget.items)) {
      for (const item of widget.items) {
        if (item && typeof item === "object" && "sql" in item && typeof item.sql === "string") {
          sqls.push(item.sql);
        }
      }
    }
  }
  return sqls;
}

/** Build candidates from saved dashboards (injected to avoid DB coupling in tests). */
export function savedDashboardCandidates(
  dashboards: Array<{ id: string; title?: string; spec: unknown }>,
): Candidate[] {
  const results: Candidate[] = [];
  for (const db of dashboards) {
    const sqls = extractSpecSqls(db.spec);
    for (const sql of sqls) {
      const fp = extractSqlFingerprint(sql);
      if (fp.length > 0) {
        results.push({
          source: `Dashboard guardado: ${db.title ?? db.id}`,
          fingerprint: fp,
        });
      }
    }
  }
  return results;
}

/** Parse SQL_PAIRS from wren-push-metadata.py using a simple regex (no AST). */
export function wrenPairCandidates(repoRoot: string): Candidate[] {
  const filePath = path.join(repoRoot, "scripts", "wren-push-metadata.py");
  let src: string;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    return []; // file not available in this environment
  }

  const candidates: Candidate[] = [];

  // Match SQL strings inside SQL_PAIRS — look for multi-line strings after "sql": """..."""
  // or "sql": "..." patterns in the Python tuple/dict structure.
  // Use a simple approach: find all triple-quoted strings that reference ps_* tables.
  const tripleQuoteRe = /"""([\s\S]*?)"""/g;
  let m: RegExpExecArray | null;
  while ((m = tripleQuoteRe.exec(src)) !== null) {
    const content = m[1];
    if (/\bps_[a-z_]+/i.test(content)) {
      const fp = extractSqlFingerprint(content);
      if (fp.length > 0) {
        candidates.push({
          source: "WrenAI SQL pair",
          locationHint: "scripts/wren-push-metadata.py",
          fingerprint: fp,
        });
      }
    }
  }

  return candidates;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface FindQueryOriginOptions {
  /** Pre-loaded saved dashboards (avoids DB call in tests). */
  savedDashboards?: Array<{ id: string; title?: string; spec: unknown }>;
  /** Absolute path to the repo root (for reading wren-push-metadata.py). */
  repoRoot?: string;
}

/**
 * Find the most likely origin of a pg_stat_statements SQL string.
 *
 * Returns null when no source reaches MIN_SIMILARITY threshold or when the
 * query fingerprint is empty (e.g. a DDL or a non-ps_* query).
 */
export function findQueryOrigin(
  rawSql: string,
  options: FindQueryOriginOptions = {},
): QueryOrigin | null {
  const target = extractSqlFingerprint(rawSql);
  if (target.length === 0) return null;

  // Collect all candidates in priority order
  const candidates: Candidate[] = [
    ...templateCandidates(),
    ...(options.savedDashboards ? savedDashboardCandidates(options.savedDashboards) : []),
    ...reviewQueryCandidates(),
    ...(options.repoRoot ? wrenPairCandidates(options.repoRoot) : []),
  ];

  let bestSim = 0;
  let bestCandidate: Candidate | null = null;

  for (const candidate of candidates) {
    const sim = jaccardSimilarity(target, candidate.fingerprint);
    if (sim > bestSim) {
      bestSim = sim;
      bestCandidate = candidate;
    }
  }

  if (bestSim < MIN_SIMILARITY || bestCandidate === null) return null;

  return {
    source: bestCandidate.source,
    locationHint: bestCandidate.locationHint,
  };
}
