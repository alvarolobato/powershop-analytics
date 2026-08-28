/**
 * Global test setup — runs before every test file.
 *
 * ## Isolation from the developer's real config
 *
 * `lib/system-config/loader.ts` resolves its config file to
 * `~/.config/powershop-analytics/config.yaml` when `CONFIG_FILE` is unset —
 * that is the OPERATOR'S LIVE CONFIG on a developer machine, so without this
 * the suite silently reads whatever that machine happens to have on disk,
 * and results depend on whose laptop (or CI runner) ran them. A test that
 * asserts "falls back to the schema default for dashboard.llm_model_openrouter"
 * passes or fails depending on whether that key happens to be pinned in the
 * local config.yaml — nothing about the code under test changed.
 *
 * Pointing `CONFIG_FILE` at a path that does not exist makes the loader fall
 * back to schema defaults, which is what unit tests should be testing. Tests
 * that need specific values still stub env vars (env beats file), and a test
 * that genuinely needs a config file can override `CONFIG_FILE` itself.
 */
process.env.CONFIG_FILE ??= "/nonexistent/powershop-test-config/config.yaml";
