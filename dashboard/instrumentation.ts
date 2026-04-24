/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Used to bootstrap config.yaml on first start: if the file does not exist,
 * it is created from the current environment variables + schema defaults.
 */

export async function register() {
  // Skip in edge runtime (middleware). In all other runtimes (Node.js standalone,
  // dev server) bootstrap the config file. Using `!== "edge"` rather than
  // `=== "nodejs"` is more robust because NEXT_RUNTIME may be undefined outside
  // the edge runtime context.
  if (process.env.NEXT_RUNTIME !== "edge") {
    try {
      const { bootstrapConfigIfMissing } = await import(
        "./lib/system-config/loader"
      );
      const created = bootstrapConfigIfMissing();
      if (created) {
        console.info(
          "[config] config.yaml created on first start at",
          process.env.CONFIG_FILE ??
            `${process.env.HOME ?? "~"}/.config/powershop-analytics/config.yaml`,
        );
      }
    } catch (err) {
      // Non-fatal: the app runs fine without config.yaml (falls back to env + defaults)
      console.warn("[config] Could not bootstrap config.yaml:", err);
    }
  }
}
