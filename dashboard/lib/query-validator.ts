import { timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";

const LARGE_TABLES = new Set([
  "ps_stock_tienda",
  "ps_lineas_ventas",
  "ps_ventas",
  "ps_gc_lin_albarane",
]);

export class QueryTooExpensiveError extends Error {
  cost: number;
  limit?: number;

  constructor(cost: number, limit?: number) {
    super(
      "Esta consulta es demasiado costosa. Intente añadir un filtro de fechas o tienda."
    );
    this.name = "QueryTooExpensiveError";
    this.cost = cost;
    this.limit = limit;
  }
}

interface PlanNode {
  "Node Type": string;
  "Total Cost"?: number;
  "Relation Name"?: string;
  Plans?: PlanNode[];
}

function extractSeqScansOnLargeTables(
  node: PlanNode,
  found: string[] = []
): string[] {
  if (
    node["Node Type"] === "Seq Scan" &&
    node["Relation Name"] &&
    LARGE_TABLES.has(node["Relation Name"])
  ) {
    found.push(node["Relation Name"]);
  }
  if (node.Plans) {
    for (const child of node.Plans) {
      extractSeqScansOnLargeTables(child, found);
    }
  }
  return found;
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function validateQueryCost(
  sql: string,
  options?: { forceHeader?: string }
): Promise<number> {
  const secret = process.env.QUERY_COST_OVERRIDE_SECRET;
  if (secret && options?.forceHeader && safeEquals(options.forceHeader, secret)) {
    return 0;
  }

  // Guard against ANALYZE injection: "EXPLAIN (FORMAT JSON) ANALYZE SELECT ..." executes the query.
  // validateReadOnly() only checks the combined EXPLAIN+sql string, so we must validate sql itself.
  if (!/^(SELECT|WITH)\b/i.test(sql.trimStart())) {
    console.warn(
      "[query-validator] SQL does not start with SELECT or WITH, skipping cost check"
    );
    return 0;
  }

  try {
    const result = await query(`EXPLAIN (FORMAT JSON) ${sql}`); // safe: sql validated to start with SELECT/WITH above; validateReadOnly() also rejects semicolons and write keywords
    const raw = result.rows[0][0] as unknown;
    // node-postgres returns json columns as parsed JS values; handle both string (test mocks) and object
    const plan = (typeof raw === "string"
      ? JSON.parse(raw)
      : raw) as [{ Plan: PlanNode }];
    const rootPlan = plan[0].Plan;
    const cost = rootPlan["Total Cost"] ?? 0;

    const defaultLimit = 100000;
    const rawLimit = process.env.QUERY_COST_LIMIT;
    const parsedLimit =
      rawLimit === undefined ? defaultLimit : parseInt(rawLimit, 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : defaultLimit;
    if (
      rawLimit !== undefined &&
      limit === defaultLimit &&
      parsedLimit !== defaultLimit
    ) {
      console.warn(
        `[query-validator] Invalid QUERY_COST_LIMIT="${rawLimit}", using default ${defaultLimit}`
      );
    }

    if (cost > limit) {
      throw new QueryTooExpensiveError(cost, limit);
    }

    const seqScans = extractSeqScansOnLargeTables(rootPlan);
    for (const tableName of seqScans) {
      console.warn(
        `[query-validator] Seq scan on large table: ${tableName}, cost=${cost}`
      );
    }

    return cost;
  } catch (err) {
    if (err instanceof QueryTooExpensiveError) {
      throw err;
    }
    console.warn(
      "[query-validator] EXPLAIN or plan parsing failed, skipping cost check:",
      err
    );
    return 0;
  }
}
