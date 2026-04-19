import { query } from "@/lib/db";

// keep in sync with ARCHITECTURE.md "### 2. PostgreSQL" -> "Key tables"
const LARGE_TABLES = new Set([
  "ps_stock_tienda",
  "ps_lineas_ventas",
  "ps_ventas",
  "ps_gc_lin_albarane",
]);

export class QueryTooExpensiveError extends Error {
  cost: number;

  constructor(cost: number) {
    super(
      "Esta consulta es demasiado costosa. Intente añadir un filtro de fechas o tienda.",
    );
    this.name = "QueryTooExpensiveError";
    this.cost = cost;
  }
}

interface PlanNode {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Total Cost"?: number;
  Plans?: PlanNode[];
}

function findSeqScansOnLargeTables(
  node: PlanNode,
  results: Array<{ relationName: string }>,
): void {
  if (
    (node["Node Type"] === "Seq Scan" ||
      node["Node Type"] === "Parallel Seq Scan") &&
    node["Relation Name"] &&
    LARGE_TABLES.has(node["Relation Name"])
  ) {
    results.push({ relationName: node["Relation Name"] });
  }
  for (const child of node.Plans ?? []) {
    findSeqScansOnLargeTables(child, results);
  }
}

function stripExplainPrefix(sql: string): string {
  let s = sql.trimStart();
  if (!/^EXPLAIN\b/i.test(s)) return s;

  s = s.slice("EXPLAIN".length);

  // Skip whitespace, SQL comments, and EXPLAIN options (ANALYZE, VERBOSE, (...))
  // in a loop so combinations like EXPLAIN /*c*/ ANALYZE are handled robustly.
  for (;;) {
    s = s.trimStart();

    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end === -1) break;
      s = s.slice(end + 2);
      continue;
    }

    if (s.startsWith("--")) {
      const end = s.indexOf("\n");
      s = end === -1 ? "" : s.slice(end + 1);
      continue;
    }

    if (/^ANALYZE\b/i.test(s)) {
      s = s.slice("ANALYZE".length);
      continue;
    }

    if (/^VERBOSE\b/i.test(s)) {
      s = s.slice("VERBOSE".length);
      continue;
    }

    if (s.startsWith("(")) {
      const end = s.indexOf(")");
      if (end === -1) break;
      s = s.slice(end + 1);
      continue;
    }

    break;
  }

  return s.trimStart();
}

export async function validateQueryCost(
  sql: string,
  options?: { forceHeader?: string },
): Promise<number> {
  const secret = process.env.QUERY_COST_OVERRIDE_SECRET;
  if (secret && options?.forceHeader === secret) {
    return 0;
  }

  try {
    // Strip any leading EXPLAIN clause (including comments between keywords) so
    // we don't produce invalid double-EXPLAIN SQL, which would fail-open.
    const sqlForPlan = stripExplainPrefix(sql);

    const result = await query(`EXPLAIN (FORMAT JSON) ${sqlForPlan}`);
    const planText = result.rows[0][0];
    const plan = (
      typeof planText === "string" ? JSON.parse(planText) : planText
    ) as Array<{ Plan: PlanNode }>;

    const cost = plan[0]["Plan"]["Total Cost"] ?? 0;
    const rawLimit = process.env.QUERY_COST_LIMIT;
    const parsedLimit =
      rawLimit === undefined || rawLimit.trim() === ""
        ? NaN
        : Number(rawLimit);
    const threshold = Number.isNaN(parsedLimit) ? 100000 : parsedLimit;

    const seqScans: Array<{ relationName: string }> = [];
    findSeqScansOnLargeTables(plan[0]["Plan"], seqScans);
    for (const { relationName } of seqScans) {
      console.warn(
        `[query-validator] Seq scan on large table: ${relationName}, cost=${cost}`,
      );
    }

    if (cost > threshold) {
      throw new QueryTooExpensiveError(cost);
    }

    return cost;
  } catch (err) {
    if (err instanceof QueryTooExpensiveError) {
      throw err;
    }
    console.warn("[query-validator] EXPLAIN failed, skipping cost check:", err);
    return 0;
  }
}
