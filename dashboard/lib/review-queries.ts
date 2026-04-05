/**
 * Predefined SQL queries for the weekly business review.
 *
 * Organized by domain: Ventas Retail, Canal Mayorista, Stock, Compras.
 * All queries are read-only and follow the SQL rules from lib/prompts.ts:
 *   - total_si for retail revenue (sin IVA)
 *   - fecha_creacion for dates
 *   - tienda <> '99' to exclude warehouse
 *   - entrada = true for sales, false for returns
 *   - base1+base2+base3 for wholesale revenue
 */

import type { QueryResult } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewQuery {
  name: string;
  sql: string;
  domain: "ventas_retail" | "canal_mayorista" | "stock" | "compras";
}

export interface ReviewQueryResult {
  query: ReviewQuery;
  result?: QueryResult;
  error?: string;
}

// ─── SQL helper: text formatter ───────────────────────────────────────────────

/**
 * Format a query result as a readable text table.
 * Used to build the text context for the LLM prompt.
 *
 * If lib/data-serializer.ts covers this use case in future, replace this.
 */
export function formatQueryResultAsText(
  name: string,
  columns: string[],
  rows: unknown[][]
): string {
  if (rows.length === 0) {
    return `${name}: (sin datos)`;
  }

  // Format numbers with locale
  const fmtVal = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return v.toLocaleString("es-ES");
    if (v instanceof Date) return v.toISOString().split("T")[0];
    return String(v);
  };

  const colWidths = columns.map((c, ci) => {
    const maxDataWidth = rows.reduce(
      (max, row) => Math.max(max, fmtVal(row[ci]).length),
      0
    );
    return Math.max(c.length, maxDataWidth);
  });

  const header = columns
    .map((c, i) => c.padEnd(colWidths[i]))
    .join(" | ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");
  const dataRows = rows.map((row) =>
    row.map((v, i) => fmtVal(v).padEnd(colWidths[i])).join(" | ")
  );

  return [`${name}:`, header, separator, ...dataRows].join("\n");
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const REVIEW_QUERIES: ReviewQuery[] = [
  // ── Ventas Retail ──────────────────────────────────────────────────────────

  {
    name: "ventas_semana_actual",
    domain: "ventas_retail",
    sql: `SELECT
  COALESCE(SUM(total_si), 0) AS ventas_netas,
  COUNT(DISTINCT reg_ventas) AS num_tickets,
  ROUND(COALESCE(SUM(total_si), 0) / NULLIF(COUNT(DISTINCT reg_ventas), 0), 2) AS ticket_medio
FROM ps_ventas
WHERE entrada = true
  AND tienda <> '99'
  AND fecha_creacion >= DATE_TRUNC('week', CURRENT_DATE)`,
  },
  {
    name: "ventas_semana_anterior",
    domain: "ventas_retail",
    sql: `SELECT
  COALESCE(SUM(total_si), 0) AS ventas_netas,
  COUNT(DISTINCT reg_ventas) AS num_tickets,
  ROUND(COALESCE(SUM(total_si), 0) / NULLIF(COUNT(DISTINCT reg_ventas), 0), 2) AS ticket_medio
FROM ps_ventas
WHERE entrada = true
  AND tienda <> '99'
  AND fecha_creacion >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
  AND fecha_creacion < DATE_TRUNC('week', CURRENT_DATE)`,
  },
  {
    name: "top3_tiendas_semana",
    domain: "ventas_retail",
    sql: `SELECT
  tienda,
  COALESCE(SUM(total_si), 0) AS ventas_netas,
  COUNT(DISTINCT reg_ventas) AS num_tickets
FROM ps_ventas
WHERE entrada = true
  AND tienda <> '99'
  AND fecha_creacion >= DATE_TRUNC('week', CURRENT_DATE)
GROUP BY tienda
ORDER BY ventas_netas DESC
LIMIT 3`,
  },
  {
    name: "bottom3_tiendas_semana",
    domain: "ventas_retail",
    sql: `SELECT
  tienda,
  COALESCE(SUM(total_si), 0) AS ventas_netas,
  COUNT(DISTINCT reg_ventas) AS num_tickets
FROM ps_ventas
WHERE entrada = true
  AND tienda <> '99'
  AND fecha_creacion >= DATE_TRUNC('week', CURRENT_DATE)
GROUP BY tienda
ORDER BY ventas_netas ASC
LIMIT 3`,
  },
  {
    name: "top5_articulos_unidades_semana",
    domain: "ventas_retail",
    sql: `SELECT
  lv.codigo,
  COALESCE(a.ccrefejofacm, lv.codigo) AS referencia,
  COALESCE(a.descripcion, lv.codigo) AS descripcion,
  SUM(lv.unidades) AS unidades_vendidas,
  COALESCE(SUM(lv.total_si), 0) AS importe_neto
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
LEFT JOIN ps_articulos a ON a.codigo = lv.codigo
WHERE v.entrada = true
  AND lv.tienda <> '99'
  AND lv.fecha_creacion >= DATE_TRUNC('week', CURRENT_DATE)
  AND lv.unidades > 0
GROUP BY lv.codigo, a.ccrefejofacm, a.descripcion
ORDER BY unidades_vendidas DESC
LIMIT 5`,
  },
  {
    name: "tasa_devolucion_semana",
    domain: "ventas_retail",
    sql: `SELECT
  COALESCE(SUM(CASE WHEN entrada = true THEN total_si ELSE 0 END), 0) AS ventas_brutas,
  COALESCE(SUM(CASE WHEN entrada = false THEN total_si ELSE 0 END), 0) AS devoluciones,
  COUNT(CASE WHEN entrada = true THEN 1 END) AS num_ventas,
  COUNT(CASE WHEN entrada = false THEN 1 END) AS num_devoluciones,
  ROUND(
    100.0 * COUNT(CASE WHEN entrada = false THEN 1 END) /
    NULLIF(COUNT(CASE WHEN entrada = true THEN 1 END), 0),
    2
  ) AS tasa_devolucion_pct
FROM ps_ventas
WHERE tienda <> '99'
  AND fecha_creacion >= DATE_TRUNC('week', CURRENT_DATE)`,
  },

  // ── Canal Mayorista ────────────────────────────────────────────────────────

  {
    name: "facturacion_mayorista_semana",
    domain: "canal_mayorista",
    sql: `SELECT
  COALESCE(SUM(base1 + base2 + base3), 0) AS facturacion_neta,
  COUNT(*) AS num_facturas
FROM ps_gc_facturas
WHERE abono = false
  AND fecha_factura >= DATE_TRUNC('week', CURRENT_DATE)`,
  },
  {
    name: "top3_clientes_mayorista_semana",
    domain: "canal_mayorista",
    sql: `SELECT
  f.num_cliente,
  COALESCE(c.nombre, f.num_cliente) AS nombre_cliente,
  COALESCE(SUM(f.base1 + f.base2 + f.base3), 0) AS facturacion_neta,
  COUNT(*) AS num_facturas
FROM ps_gc_facturas f
LEFT JOIN ps_clientes c ON c.codigo = f.num_cliente
WHERE f.abono = false
  AND f.fecha_factura >= DATE_TRUNC('week', CURRENT_DATE)
GROUP BY f.num_cliente, c.nombre
ORDER BY facturacion_neta DESC
LIMIT 3`,
  },
  {
    name: "albaranes_pendientes_facturar",
    domain: "canal_mayorista",
    sql: `SELECT COUNT(*) AS albaranes_pendientes
FROM ps_gc_albaranes a
WHERE a.abono = false
  AND NOT EXISTS (
    SELECT 1 FROM ps_gc_facturas f
    WHERE f.num_albaran = a.reg_albaran
  )`,
  },

  // ── Stock ──────────────────────────────────────────────────────────────────

  {
    name: "stock_total_unidades",
    domain: "stock",
    sql: `SELECT
  COUNT(DISTINCT codigo) AS num_referencias,
  SUM(unidades) AS unidades_totales,
  SUM(CASE WHEN tienda <> '99' THEN unidades ELSE 0 END) AS unidades_tiendas,
  SUM(CASE WHEN tienda = '99' THEN unidades ELSE 0 END) AS unidades_almacen
FROM ps_stock_tienda
WHERE unidades > 0`,
  },
  {
    name: "articulos_stock_critico",
    domain: "stock",
    sql: `SELECT
  codigo,
  SUM(unidades) AS stock_total
FROM ps_stock_tienda
GROUP BY codigo
HAVING SUM(unidades) < 5 AND SUM(unidades) > 0
ORDER BY stock_total ASC
LIMIT 20`,
  },
  {
    name: "traspasos_semana",
    domain: "stock",
    sql: `SELECT
  COUNT(*) AS num_traspasos,
  SUM(unidades) AS unidades_traspasadas
FROM ps_traspasos
WHERE fecha_traspaso >= DATE_TRUNC('week', CURRENT_DATE)`,
  },

  // ── Compras ────────────────────────────────────────────────────────────────

  {
    name: "compras_semana_actual",
    domain: "compras",
    sql: `SELECT
  COUNT(*) AS num_pedidos,
  COALESCE(SUM(importe_total), 0) AS importe_total
FROM ps_compras
WHERE fecha_pedido >= DATE_TRUNC('week', CURRENT_DATE)`,
  },
  {
    name: "compras_semana_anterior",
    domain: "compras",
    sql: `SELECT
  COUNT(*) AS num_pedidos,
  COALESCE(SUM(importe_total), 0) AS importe_total
FROM ps_compras
WHERE fecha_pedido >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
  AND fecha_pedido < DATE_TRUNC('week', CURRENT_DATE)`,
  },
];

// ─── Query executor ───────────────────────────────────────────────────────────

/**
 * Execute all review queries using the provided query function.
 *
 * Accepts a query executor (to allow testing with mocks). If a query fails,
 * the error is captured and remaining queries continue (partial results are
 * better than no review at all).
 *
 * If a connection-level error is detected (ECONNREFUSED, ENOTFOUND, etc.) it
 * is re-thrown immediately so the API route can return a 503 without incurring
 * LLM cost.
 *
 * @param queryFn - Function that accepts SQL and returns a QueryResult promise
 * @returns Array of ReviewQueryResult (success or error per query)
 */
export async function executeReviewQueries(
  queryFn: (sql: string) => Promise<QueryResult>
): Promise<ReviewQueryResult[]> {
  const results = await Promise.allSettled(
    REVIEW_QUERIES.map((q) => queryFn(q.sql))
  );

  return REVIEW_QUERIES.map((q, i) => {
    const settled = results[i];
    if (settled.status === "fulfilled") {
      return { query: q, result: settled.value };
    } else {
      const err = settled.reason;
      // Re-throw connection-level errors — the caller should return 503
      // rather than waste an LLM call with an empty result set
      if (err instanceof Error) {
        const name = err.constructor?.name ?? "";
        if (
          name === "ConnectionError" ||
          (err as { code?: string }).code === "ECONNREFUSED" ||
          (err as { code?: string }).code === "ENOTFOUND" ||
          (err as { code?: string }).code === "ETIMEDOUT"
        ) {
          throw err;
        }
      }
      return {
        query: q,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/**
 * Normalize a raw execution error message for inclusion in LLM context.
 *
 * Avoids leaking operational details (host names, SQL text, connection strings)
 * from database/driver error messages while preserving enough signal for the
 * model to understand that a query failed.
 */
function normalizeErrorForLlm(error: string): string {
  const normalized = error.trim().toLowerCase();

  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("statement timeout")
  ) {
    return "tiempo de espera agotado al ejecutar la consulta";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("not authorized") ||
    normalized.includes("insufficient privilege") ||
    normalized.includes("access denied")
  ) {
    return "sin permisos para ejecutar la consulta";
  }

  if (
    normalized.includes("connection") ||
    normalized.includes("connect") ||
    normalized.includes("econnrefused") ||
    normalized.includes("could not translate host name") ||
    normalized.includes("no route to host")
  ) {
    return "fallo de conexión a la base de datos";
  }

  if (
    normalized.includes("syntax error") ||
    normalized.includes("does not exist") ||
    normalized.includes("undefined table") ||
    normalized.includes("undefined column") ||
    normalized.includes("invalid input syntax")
  ) {
    return "consulta inválida o incompatible con el esquema";
  }

  return "error interno al ejecutar la consulta";
}

/**
 * Format all query results as a single text block for LLM context.
 */
export function formatAllResults(results: ReviewQueryResult[]): string {
  const sections = results.map((r) => {
    if (r.error) {
      return `${r.query.name}: (error: ${normalizeErrorForLlm(r.error)})`;
    }
    if (!r.result) {
      return `${r.query.name}: (sin datos)`;
    }
    return formatQueryResultAsText(
      r.query.name,
      r.result.columns,
      r.result.rows
    );
  });

  return sections.join("\n\n");
}
