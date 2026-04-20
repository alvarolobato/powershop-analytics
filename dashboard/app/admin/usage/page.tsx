import Link from "next/link";
import { getLlmUsageAggregates } from "@/lib/llm-usage-stats";
import {
  formatIntegerEs,
  formatTokensWithCompact,
  formatUsdEs,
} from "@/lib/usage-number-format";

export const metadata = {
  title: "Uso LLM — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminUsagePage() {
  const u = await getLlmUsageAggregates();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Uso del modelo (llm_usage)
        </h1>
        <nav className="flex gap-3 text-sm">
          <Link href="/admin/slow-queries" className="text-blue-600 hover:underline dark:text-blue-400">
            Consultas lentas
          </Link>
          <Link href="/" className="text-tremor-content dark:text-dark-tremor-content hover:underline">
            Inicio
          </Link>
        </nav>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        {(["today", "week", "month"] as const).map((period) => {
          const p = u[period];
          const tokens = formatTokensWithCompact(p.total_tokens);
          return (
            <div
              key={period}
              className="rounded-lg border border-tremor-border dark:border-dark-tremor-border p-4"
            >
              <h2 className="text-sm font-medium capitalize text-tremor-content dark:text-dark-tremor-content">
                {period === "today" ? "Hoy" : period === "week" ? "7 días" : "30 días"}
              </h2>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{tokens.primary}</p>
              <p className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                ≈ {tokens.compact} tokens (compacto)
              </p>
              <p className="mt-1 text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Entrada {formatIntegerEs(p.prompt_tokens)} · Salida{" "}
                {formatIntegerEs(p.completion_tokens)}
              </p>
              <p className="mt-2 text-sm font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {formatUsdEs(p.estimated_cost_usd)}{" "}
                <span className="text-xs font-normal text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                  coste estimado
                </span>
              </p>
            </div>
          );
        })}
      </section>

      <section
        className="rounded-lg border border-amber-200/80 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
        role="note"
      >
        <p className="font-medium">Cómo se calcula el coste</p>
        <p className="mt-1 leading-relaxed">
          Cada llamada guarda tokens de entrada y salida. El importe en USD es una{" "}
          <strong>estimación interna</strong>: se multiplica cada tipo de token por un precio
          fijo por millón definido en el código del servidor (alineado con la tarifa de lista del
          modelo configurado, hoy <code className="rounded bg-black/5 px-1 dark:bg-white/10">anthropic/claude-sonnet-4</code>
          ). <strong>No</strong> se consulta la facturación ni la API de costes de OpenRouter, así
          que puede diferir del cargo real (descuentos, caché, redondeos, cambios de tarifa).
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Por función
        </h2>
        <p className="mb-3 text-xs text-tremor-content dark:text-dark-tremor-content">
          La columna «Clave» es el identificador técnico enviado a la base de datos; la
          descripción resume qué pantalla o flujo del dashboard disparó la petición al modelo.
        </p>
        <div className="overflow-x-auto rounded-lg border border-tremor-border dark:border-dark-tremor-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-tremor-background-muted dark:bg-dark-tremor-background-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Función</th>
                <th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 font-medium">Clave</th>
                <th className="px-3 py-2 font-medium">Llamadas</th>
                <th className="px-3 py-2 font-medium">Tokens</th>
                <th className="px-3 py-2 font-medium">Coste est.</th>
              </tr>
            </thead>
            <tbody>
              {u.by_endpoint.map((row) => {
                const tok = formatTokensWithCompact(row.total_tokens);
                return (
                  <tr
                    key={row.endpoint}
                    className="border-t border-tremor-border dark:border-dark-tremor-border align-top"
                  >
                    <td className="px-3 py-2 font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
                      {row.endpoint_label_es}
                    </td>
                    <td className="max-w-md px-3 py-2 text-xs text-tremor-content dark:text-dark-tremor-content">
                      {row.endpoint_detail_es}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                      {row.endpoint}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatIntegerEs(row.calls)}</td>
                    <td className="px-3 py-2">
                      <span className="whitespace-nowrap font-medium">{tok.primary}</span>
                      <span className="mt-0.5 block text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                        ≈ {tok.compact}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatUsdEs(row.estimated_cost_usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
