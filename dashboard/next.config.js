const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Required on Next.js 14 to actually run instrumentation.ts at server
  // start. Without this flag the file is silently ignored, so the
  // config-bootstrap and init.sql-migration steps in instrumentation.ts
  // never execute. Default-on from Next 15; explicit until we upgrade.
  experimental: {
    instrumentationHook: true,
    // OTel packages (loaded from instrumentation.ts — see lib/otel/sdk.ts)
    // must stay real `node_modules` requires, not get webpack-bundled into a
    // server chunk. Without this, `next build` still succeeds, but
    // everything reached from lib/otel/sdk.ts (including @grpc/grpc-js,
    // used by the gRPC OTLP exporters) gets inlined into a >1MB chunk
    // instead of staying external — and the standalone output tracer then
    // has nothing to copy into `.next/standalone/node_modules/@opentelemetry/*`,
    // since as far as it can tell nothing outside the bundle was required.
    // Verified empirically: with this list absent,
    // `.next/standalone/node_modules/@opentelemetry/` contained only the
    // `api` package after `next build`. `serverExternalPackages` is the
    // Next 15 stable name for this option; on the pinned Next 14.2.x it is
    // still `experimental.serverComponentsExternalPackages`. See
    // docs/decisions/D-052-dashboard-otel-sdk.md.
    serverComponentsExternalPackages: [
      "@opentelemetry/api",
      "@opentelemetry/api-logs",
      "@opentelemetry/resources",
      "@opentelemetry/semantic-conventions",
      "@opentelemetry/sdk-logs",
      "@opentelemetry/sdk-node",
      "@opentelemetry/exporter-trace-otlp-grpc",
      "@opentelemetry/exporter-logs-otlp-grpc",
      "@opentelemetry/instrumentation",
      "@opentelemetry/instrumentation-http",
      "@opentelemetry/instrumentation-undici",
      "@opentelemetry/instrumentation-pg",
    ],
  },
  env: {
    NEXT_PUBLIC_APP_PKG_VERSION: (() => {
      const raw = fs.readFileSync(path.join(__dirname, "package.json"), "utf8");
      return JSON.parse(raw).version;
    })(),
    NEXT_PUBLIC_APP_GIT_DESCRIBE: (() => {
      const fromEnv = process.env.APP_GIT_DESCRIBE?.trim();
      if (fromEnv) return fromEnv;
      try {
        return execSync("git describe --tags --always --dirty", {
          cwd: __dirname,
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    })(),
  },
};

module.exports = nextConfig;
