/**
 * Runtime-safe public URL helpers.
 *
 * These are read from process.env at request time (NOT baked in at build
 * time like NEXT_PUBLIC_*), so the same Docker image works for any hostname.
 *
 * Defaults match the standard local-dev ports.
 */

export function getAppPublicUrl(): string {
  return (process.env.APP_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

export function getWrenPublicUrl(): string {
  return (process.env.WREN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
