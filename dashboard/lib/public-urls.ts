/**
 * Runtime-safe public URL helpers.
 *
 * Reads from the config loader (env > config.yaml > schema defaults) so
 * changes made via the /admin/config UI take effect on the next page load
 * without needing to restart the container.
 *
 * Falls back to localhost defaults when the config system is unavailable
 * (e.g. during tests or when schema.yaml is missing).
 *
 * NOTE: these functions run server-side only (called from Server Components).
 */

export function getAppPublicUrl(): string {
  // Lazy import to avoid pulling the loader into client bundles.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSystemConfig } = require("@/lib/system-config/loader");
    const cfg = getSystemConfig();
    const val = cfg["dashboard.app_public_url"]?.value;
    if (val && typeof val === "string" && val.trim()) {
      return val.trim().replace(/\/$/, "");
    }
  } catch {
    // Schema or loader unavailable — fall through to env/default.
  }
  return (process.env.APP_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

export function getWrenPublicUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSystemConfig } = require("@/lib/system-config/loader");
    const cfg = getSystemConfig();
    const val = cfg["dashboard.wren_public_url"]?.value;
    if (val && typeof val === "string" && val.trim()) {
      return val.trim().replace(/\/$/, "");
    }
  } catch {
    // Schema or loader unavailable — fall through to env/default.
  }
  return (process.env.WREN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
