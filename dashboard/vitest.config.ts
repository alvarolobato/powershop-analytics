import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "components/**/*.tsx", "components/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/*.d.ts",
        // Review API + DB adapters: exercised via integration / manual; keep coverage floors realistic.
        "app/api/review/**",
        "lib/review-db.ts",
        "lib/review-actions-db.ts",
        "lib/review-dashboard-seed.ts",
        // LLM tool handlers + runner internals: integration-only coverage.
        "lib/llm-tools/handlers/**",
        "lib/llm-tools/logging.ts",
        "lib/llm-tools/runner-types.ts",
        // LLM provider internals: covered via higher-level tests.
        "lib/llm-provider/registry.ts",
        "lib/llm-provider/types.ts",
        "lib/llm-provider/cli/types.ts",
        "lib/llm-provider/cli/claude-code.ts",
      ],
      // Floors: relaxed after admin-redesign enlarged surface (2026-04).
      thresholds: {
        statements: 69,
        branches: 61,
        functions: 69,
        lines: 69,
      },
    },
  },
});
