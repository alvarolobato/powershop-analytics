/**
 * OTel resource attributes for the dashboard server process.
 *
 * Kept separate from sdk.ts so the (pure, side-effect-free) name/version/
 * environment resolution logic can be unit tested without touching the
 * OpenTelemetry SDK itself.
 */

import { resourceFromAttributes } from "@opentelemetry/resources";
import type { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  // Deprecated in the newest semconv (superseded by
  // deployment.environment.name), but this is the exact key
  // otel/otelcol-config.yaml's `resource` processor upserts
  // (`deployment.environment` from the collector's own ENVIRONMENT env) —
  // matching it here means both the SDK-set and collector-upserted values
  // land on the same attribute key instead of two similarly-named ones.
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";

/** The canonical service name. Every other name is a bug. */
export const DEFAULT_SERVICE_NAME = "powershop-dashboard";

/**
 * Resolve service.name: OTEL_SERVICE_NAME wins when set (so compose / an
 * operator can override), otherwise the hardcoded default — so a bare
 * `npm run dev` outside docker-compose is still correctly identified in
 * Kibana APM instead of showing up as "unknown_service:node".
 */
export function resolveServiceName(): string {
  const fromEnv = process.env.OTEL_SERVICE_NAME?.trim();
  return fromEnv || DEFAULT_SERVICE_NAME;
}

/**
 * Resolve service.version from the build-time package version. Next.js
 * inlines `NEXT_PUBLIC_APP_PKG_VERSION` (see next.config.js `env` block)
 * wherever `process.env.NEXT_PUBLIC_APP_PKG_VERSION` appears in code
 * compiled by webpack — same mechanism `lib/app-version-label.ts` relies on.
 */
export function resolveServiceVersion(): string {
  return process.env.NEXT_PUBLIC_APP_PKG_VERSION?.trim() || "0.0.0";
}

/** Resolve deployment.environment, mirroring docker-compose's own default. */
export function resolveDeploymentEnvironment(): string {
  return process.env.ENVIRONMENT?.trim() || "development";
}

export function buildOtelResource(): Resource {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: resolveServiceName(),
    [ATTR_SERVICE_VERSION]: resolveServiceVersion(),
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: resolveDeploymentEnvironment(),
  });
}
