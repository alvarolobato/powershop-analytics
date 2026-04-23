import { fetchSlowQueries } from "@/lib/admin-slow-queries";

export const metadata = {
  title: "Consultas lentas — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminSlowQueriesPage() {
  const data = await fetchSlowQueries();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
        Consultas lentas (pg_stat_statements)
      </h1>

      {data.error && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {data.error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-tremor-border dark:border-dark-tremor-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-tremor-background-muted dark:bg-dark-tremor-background-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Consulta</th>
              <th className="px-3 py-2 font-medium">Llamadas</th>
              <th className="px-3 py-2 font-medium">Media ms</th>
              <th className="px-3 py-2 font-medium">Máx ms</th>
              <th className="px-3 py-2 font-medium">Total ms</th>
              <th className="px-3 py-2 font-medium">Filas</th>
              <th className="px-3 py-2 font-medium">Cache %</th>
            </tr>
          </thead>
          <tbody>
            {data.queries.map((q, i) => (
              <tr
                key={i}
                className="border-t border-tremor-border dark:border-dark-tremor-border align-top"
              >
                <td className="max-w-xl whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs">
                  {q.query}
                </td>
                <td className="px-3 py-2">{q.calls}</td>
                <td className="px-3 py-2">{q.mean_exec_time_ms}</td>
                <td className="px-3 py-2">{q.max_exec_time_ms}</td>
                <td className="px-3 py-2">{q.total_exec_time_ms}</td>
                <td className="px-3 py-2">{q.rows}</td>
                <td className="px-3 py-2">{q.cache_hit_ratio ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
