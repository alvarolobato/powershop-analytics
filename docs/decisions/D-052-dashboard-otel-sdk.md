---
id: D-052
title: Dashboard emits traces and logs via the OTel Node SDK, fail-open, console-bridged
date: 2026-08-28
---

# D-052: Dashboard emits traces and logs via the OTel Node SDK, fail-open, console-bridged

*Decided: 2026-08-28*

**Context**: The dashboard had no OpenTelemetry dependency at all —
`dashboard/package.json` had no `@opentelemetry/*` packages, and
`dashboard/instrumentation.ts`, despite the name, only bootstrapped
`config.yaml` and ran the `init.sql` migration; it never emitted a span.
Meanwhile `docker-compose.yml` already set `OTEL_SERVICE_NAME`,
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_TRACES_SAMPLER*` on the `dashboard`
service — dead config nothing read. The ETL side already runs under
`opentelemetry-instrument` (Python) and exports successfully to the
collector defined in `otel/otelcol-config.yaml`.

The app logs via 118 bare `console.*` call sites with no logger module.
Rewriting all of them was out of scope.

This codebase has been bitten twice by telemetry breaking the product: an
unreachable OTLP exporter on the ETL side once produced 381,000 log lines,
and a collector crash-loop once blocked the whole local stack from starting
(D-042). Any dashboard instrumentation had to be fail-open by construction.

**Decision**:

1. **Packages** (`dashboard/package.json`): `@opentelemetry/sdk-node` (bundles
   the trace/log SDKs, resources, context managers), the gRPC trace and log
   exporters (`exporter-trace-otlp-grpc`, `exporter-logs-otlp-grpc` — gRPC to
   match the ETL side and because `OTEL_EXPORTER_OTLP_ENDPOINT` is set to the
   collector's gRPC port 4317, not its HTTP port 4318), and three
   instrumentations: `instrumentation-http` (Next server + node:http/https),
   `instrumentation-undici` (fetch — both Next's built-in `fetch` and the
   `openai` SDK's HTTP client run on undici, not node:http), and
   `instrumentation-pg` (the `pg` connection pools in `lib/db.ts` /
   `lib/db-write.ts`).

2. **Wiring** (`dashboard/instrumentation.ts` → `dashboard/lib/otel/`): OTel
   init happens first inside the existing `register()` hook's
   `NEXT_RUNTIME !== "edge"` guard, in its own try/catch, before the
   pre-existing config-bootstrap and migration steps — so instrumentation is
   active before those steps run, and a telemetry failure can never stop
   config bootstrap or migration.
   - `lib/otel/resource.ts` — resolves `service.name` (`OTEL_SERVICE_NAME` →
     fallback `"powershop-dashboard"`, never anything else),
     `service.version` (`NEXT_PUBLIC_APP_PKG_VERSION`, the same build-time
     env `lib/app-version-label.ts` already uses), and
     `deployment.environment` (`ENVIRONMENT` → `"development"`), using the
     deprecated-but-matching `deployment.environment` key so it lands on the
     exact attribute `otel/otelcol-config.yaml`'s `resource` processor
     upserts.
   - `lib/otel/sdk.ts` — constructs and starts the `NodeSDK`. The trace
     sampler is deliberately **not** passed explicitly: `NodeSDK` falls back
     to `createSamplerFromEnv()`, which reads `OTEL_TRACES_SAMPLER` /
     `OTEL_TRACES_SAMPLER_ARG` (compose sets `parentbased_traceidratio` @
     0.1, per D-042) — passing an explicit sampler would silently stop
     honoring that env contract. Skips entirely when
     `NEXT_PHASE === "phase-production-build"` (set by `next build`) so
     `next build` never opens a network/timer handle for nothing to export.
     Idempotent (`sdk` module singleton) so Next dev-mode hot reload
     re-running `instrumentation.ts` doesn't double-init. The whole body is
     one try/catch — any failure (bad config, a throwing instrumentation,
     anything) is caught, logged via `console.warn`, and treated as
     "telemetry off for this run," never a startup failure.
   - `lib/otel/console-bridge.ts` — patches
     `console.{debug,info,log,warn,error}` to call the **original** method
     first, unconditionally, then best-effort `logs.getLogger(...).emit(...)`
     the same line as an OTel log record. A module-level re-entrancy guard
     means even a bug that makes `emit()` itself call a patched console
     method can't recurse. The OTel API's `diag` logger is deliberately
     **never** set to a `DiagConsoleLogger` — it stays the default no-op —
     specifically so the SDK's own internal export-failure diagnostics can
     never feed back through the console bridge into more log records; that
     exact feedback shape is what produced 381,000 lines on the ETL side.
   - Bounding: both the span and log processors are the OTel SDK's own
     `Batch*Processor` (default `maxQueueSize` 2048, `maxExportBatchSize`
     512) — an unreachable collector fills the queue, then drops the oldest
     records; it never grows unbounded and never blocks the request that
     produced the span/log.
   - Shutdown: `instrumentation.ts` registers a `process.once("SIGTERM", …)`
     handler that calls `shutdownOtel()`, itself `Promise.race`d against a
     5s timeout so a hung exporter can't hang container shutdown.

3. **`next.config.js` — `experimental.serverComponentsExternalPackages`**:
   all thirteen `@opentelemetry/*` packages imported by `lib/otel/*` are
   listed here. Without this, `next build` still succeeds, but webpack
   bundles the entire OTel dependency graph — including `@grpc/grpc-js`,
   pulled in transitively by the gRPC exporters — into a single >1MB server
   chunk instead of leaving it as a real `node_modules` require. Verified
   empirically: with the list absent,
   `.next/standalone/node_modules/@opentelemetry/` contained only the `api`
   package after a production build (everything else got inlined into the
   chunk and the standalone file-tracer had nothing external left to copy);
   with the list present, all needed packages — `@opentelemetry/*` down to
   `@grpc/grpc-js` and `@grpc/proto-loader` — are copied into
   `.next/standalone/node_modules/` as expected. `serverExternalPackages` is
   the Next 15 stable name for this option; the pinned Next 14.2.x here only
   has the experimental name.

**Verification performed**: built the standalone output
(`SKIP_DB_MIGRATE=1 npm run build`), ran `node server.js` from
`.next/standalone` in a throwaway container attached to the
`powershop-analytics_wren` docker network (the same network
`powershop-analytics-otel-collector-1` runs on), hit `/api/health` twice, and
grepped the collector's `file` exporter output
(`docker exec … cat /var/log/otel/local.jsonl`). Confirmed both a
`resourceLogs` record (scope `powershop-dashboard-console`, carrying the
exact `console.info` lines the server printed on boot) and a `resourceSpans`
record (scopes `next.js` and `@opentelemetry/instrumentation-http`, spans
including `GET /api/health` and `executing api route (app) /api/health/route`)
— both stamped `service.name=powershop-dashboard`,
`service.version=0.1.0`, `deployment.environment=development`. `docker stop`
on the verification container returned in ~0.1s, confirming the SIGTERM
shutdown path is not hanging.

**Alternatives rejected**:
- *`@vercel/otel` convenience wrapper*: adds another abstraction layer over
  the same underlying SDK and doesn't obviously simplify the gRPC-exporter /
  console-bridge / build-externals concerns this decision had to solve
  directly anyway; the raw SDK keeps the fail-open and bounding behavior
  fully auditable in this repo's own code.
- *`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` + HTTP exporters instead of
  gRPC*: would have silently mismatched the collector's gRPC receiver on
  port 4317 that `OTEL_EXPORTER_OTLP_ENDPOINT` already points at (the
  collector's HTTP receiver is on 4318) — matching the ETL side's gRPC
  exporter was simpler and correct here.
- *Rewrite the 118 `console.*` call sites to a logger module*: far larger
  surface, explicitly out of scope; the console bridge gets the same
  observability outcome without touching any of them.
- *Wire `diag.setLogger(new DiagConsoleLogger())` to honor `OTEL_LOG_LEVEL`
  for the SDK's own diagnostics*: rejected — this is exactly the feedback
  path that caused the 381,000-line incident on the ETL side; left as a
  no-op (`OTEL_LOG_LEVEL` is consumed by the Python side's
  `opentelemetry-instrument` bootstrap only, not by this SDK).

**Rationale**: Every fail-open requirement traces to a real prior incident
in this repo (D-042's collector crash-loop, the ETL's 381,000-line exporter
storm); this module is deliberately paranoid because those incidents are the
actual cost model, not a hypothetical one. Externalizing the OTel packages
in `next.config.js` was found only by inspecting the standalone build output
directly — `next build` gives no warning when it silently inlines a
dependency graph the standalone tracer then can't see.

**Not done in this change** (left for a follow-up): `dashboard/lib/db-write.ts`
already declares a `TraceContext { traceId, spanId }` type and `init.sql`
already has `trace_id`/`span_id` columns on `etl_sync_runs`,
`etl_sync_run_tables`, `llm_tool_calls`, `llm_errors`, and
`llm_interactions` (added ahead of this work), but nothing in the dashboard
actually reads the active span's trace context and writes it into those
rows yet — click-through from the admin UI to Kibana APM is not wired.
Client-side / browser instrumentation is also explicitly out of scope here
(deferred, see `ELASTIC_RUM_*` in `.env.example`).

**See**: `dashboard/lib/otel/{resource,sdk,console-bridge}.ts`,
`dashboard/instrumentation.ts`, `dashboard/next.config.js`,
`otel/otelcol-config.yaml`, `docker-compose.yml` (dashboard service OTEL_*
env), [D-042](D-042-otel-head-sampling.md).
