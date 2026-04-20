import Link from "next/link";
import { getLlmUsageAggregates } from "@/lib/llm-usage-stats";

export const metadata = {
  title: "Uso LLM — Admin",
};

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
        {(["today", "week", "month"] as const).map((period) => (
          <div
            key={period}
            className="rounded-lg border border-tremor-border dark:border-dark-tremor-border p-4"
          >
            <h2 className="text-sm font-medium capitalize text-tremor-content dark:text-dark-tremor-content">
              {period === "today" ? "Hoy" : period === "week" ? "7 días" : "30 días"}
            </h2>
            <p className="mt-2 text-2xl font-semibold">{u[period].total_tokens}</p>
            <p className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              tokens · {u[period].estimated_cost_usd} USD est.
            </p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Por endpoint
        </h2>
        <div className="overflow-x-auto rounded-lg border border-tremor-border dark:border-dark-tremor-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-tremor-background-muted dark:bg-dark-tremor-background-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Endpoint</th>
                <th className="px-3 py-2 font-medium">Llamadas</th>
                <th className="px-3 py-2 font-medium">Tokens</th>
                <th className="px-3 py-2 font-medium">Coste USD</th>
              </tr>
            </thead>
            <tbody>
              {u.by_endpoint.map((row) => (
                <tr
                  key={row.endpoint}
                  className="border-t border-tremor-border dark:border-dark-tremor-border"
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.endpoint}</td>
                  <td className="px-3 py-2">{row.calls}</td>
                  <td className="px-3 py-2">{row.total_tokens}</td>
                  <td className="px-3 py-2">{row.estimated_cost_usd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
