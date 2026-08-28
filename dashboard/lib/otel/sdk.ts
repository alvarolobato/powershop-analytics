/**
 * OpenTelemetry Node SDK bootstrap for the dashboard server process.
 *
 * See docs/decisions/D-052-dashboard-otel-sdk.md for the full rationale.
 * Short version:
 *  - Traces + logs go out over OTLP/gRPC to OTEL_EXPORTER_OTLP_ENDPOINT
 *    (defaults to the SDK's own default, http://localhost:4317, when unset —
 *    docker-compose.yml always sets it to http://otel-collector:4317).
 *  - service.name is ALWAYS "powershop-dashboard" unless OTEL_SERVICE_NAME
 *    overrides it (see resource.ts).
 *  - Console output is bridged to OTel logs (console-bridge.ts) without
 *    touching any of the app's 118 existing `console.*` call sites.
 *  - Every failure mode here is caught and logged, never thrown: a
 *    telemetry problem (unreachable collector, bad config, exporter
 *    exception) must degrade to "no telemetry", never to "broken app". This
 *    codebase has twice been bitten by telemetry breaking the product —
 *    381,000 log lines from an unreachable OTLP exporter on the ETL side,
 *    and a collector crash-loop that once blocked the whole stack from
 *    starting (D-042) — so this module is deliberately paranoid about
 *    failing open.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { logs } from "@opentelemetry/api-logs";
import { buildOtelResource, resolveServiceName } from "./resource";
import { installConsoleBridge } from "./console-bridge";

let sdk: NodeSDK | null = null;

/**
 * True while running `next build` (Next sets NEXT_PHASE to this value for
 * the build process only — not for `next dev` or `next start`). We must not
 * start exporters/background timers during build: nothing needs to be
 * shipped, and a hung network handle could stop `next build` from exiting.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Initialise the OTel SDK (traces + logs) and the console→logs bridge.
 * Safe to call more than once (e.g. Next.js dev-mode hot reload re-running
 * instrumentation.ts) — a no-op after the first successful call. Never
 * throws: every failure is caught, logged via the *original* console.warn,
 * and treated as "telemetry disabled for this run", not a startup failure.
 */
export function initOtel(): void {
  if (sdk) return; // already initialized
  if (isBuildPhase()) return; // never during `next build`

  try {
    const traceExporter = new OTLPTraceExporter();
    const logExporter = new OTLPLogExporter();

    sdk = new NodeSDK({
      resource: buildOtelResource(),
      traceExporter,
      // Bounded batch processor (default maxQueueSize 2048, default
      // maxExportBatchSize 512) — an unreachable collector fills the queue
      // and then drops the oldest records; it never grows unbounded and
      // never blocks the request that produced the log record.
      logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
      // Sampler intentionally omitted: NodeSDK falls back to
      // createSamplerFromEnv(), which reads OTEL_TRACES_SAMPLER /
      // OTEL_TRACES_SAMPLER_ARG (docker-compose sets
      // parentbased_traceidratio @ 0.1) — see D-042.
      instrumentations: [
        // Instruments the Next.js server's incoming HTTP requests and any
        // outbound calls made via node:http / node:https.
        new HttpInstrumentation(),
        // Outbound fetch()/undici calls — Next's built-in fetch and the
        // `openai` SDK's HTTP client both run on undici, not node:http.
        new UndiciInstrumentation(),
        // PostgreSQL query spans (db-write.ts / db.ts connection pools).
        new PgInstrumentation(),
      ],
    });

    // NodeSDK#start() is synchronous and can throw for a bad configuration
    // (e.g. a malformed instrumentation) — never let that escape.
    sdk.start();

    // Only bridge console output once the SDK (and therefore the global
    // LoggerProvider it registers) is actually up.
    installConsoleBridge(logs.getLogger("powershop-dashboard-console"));

    // Intentionally NOT calling diag.setLogger(new DiagConsoleLogger()).
    // The OTel API's diag logger defaults to a no-op. Wiring it to console
    // would feed the SDK's own internal export-failure diagnostics back
    // through the console bridge above — exactly the kind of self-inflicted
    // log storm that produced 381,000 lines on the ETL side once already.
  } catch (err) {
    sdk = null;
    console.warn("[otel] SDK initialization failed; continuing without telemetry:", err);
  }
}

/**
 * Flush and shut down the SDK. Called from instrumentation.ts's SIGTERM
 * handler so a container stop doesn't drop the last in-flight batch.
 * Bounded by `timeoutMs` — a hung exporter must not hang shutdown.
 */
export async function shutdownOtel(timeoutMs = 5000): Promise<void> {
  const active = sdk;
  if (!active) return;
  sdk = null;

  await Promise.race([
    active.shutdown().catch((err) => {
      console.warn("[otel] shutdown() failed:", err);
    }),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Test-only: reset the module-level singleton between test cases. */
export function __resetOtelStateForTests(): void {
  sdk = null;
}

/** Test-only: whether the SDK is currently initialized. */
export function __isOtelInitializedForTests(): boolean {
  return sdk !== null;
}

export function getServiceNameForDiagnostics(): string {
  return resolveServiceName();
}
