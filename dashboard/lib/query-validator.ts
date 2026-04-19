import { query } from "@/lib/db";

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
      "Esta consulta es demasiado costosa. Intente añadir un filtro de fechas o tienda."
    );
    this.name = "QueryTooExpensiveError";
    this.cost = cost;
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

export async function validateQueryCost(
  sql: string,
  options?: { forceHeader?: string }
): Promise<number> {
  const secret = process.env.QUERY_COST_OVERRIDE_SECRET;
  if (secret && options?.forceHeader === secret) {
    return 0;
  }

  try {
    const result = await query(`EXPLAIN (FORMAT JSON) ${sql}`);
    const planJson = result.rows[0][0] as string;
    const plan = JSON.parse(planJson) as [{ Plan: PlanNode }];
    const rootPlan = plan[0].Plan;
    const cost = rootPlan["Total Cost"] ?? 0;

    const limit = parseInt(process.env.QUERY_COST_LIMIT ?? "100000", 10);
    if (cost > limit) {
      throw new QueryTooExpensiveError(cost);
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
    console.warn("[query-validator] EXPLAIN failed, skipping cost check:", err);
    return 0;
  }
}
