/**
 * GET /api/health — Liveness check for Docker healthcheck.
 *
 * Returns 200 with `{ status: "ok", llm_circuit: ... }` where `llm_circuit` is the
 * dashboard LLM circuit breaker state (`closed` | `open` | `half-open`), plus
 * `fotos`: `{ last_sync, horas, ficheros }` from the article-photo mirror's
 * marker file, or `null` when no mirror is configured.
 */
import { NextResponse } from "next/server";
import { getCircuitState } from "@/lib/llm-circuit-breaker";
import { estadoEspejo } from "@/lib/fotos";

// Liveness/circuit state must be read per request, never a build-time
// snapshot — without this, Next's App Router can statically render or
// ISR-cache this handler's output, so a Docker/orchestrator liveness probe
// could keep getting a stale response instead of a live check.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // `fotos` es informativo: la edad del espejo de fotos de artículo (D-068).
  // No altera `status`: sin fotos la app funciona igual. `null` = sin espejo.
  return NextResponse.json({
    status: "ok",
    llm_circuit: getCircuitState(),
    fotos: await estadoEspejo().catch(() => null),
  });
}
