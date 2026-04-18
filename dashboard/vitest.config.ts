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
      exclude: ["**/__tests__/**", "**/node_modules/**", "**/*.d.ts"],
      // Floors measured 2026-04-18 (baseline run). Set ~5% below observed.
      // Observed: statements 78%, branches 67%, functions 79%, lines 80%.
      thresholds: {
        statements: 73,
        branches: 62,
        functions: 74,
        lines: 75,
      },
    },
  },
});
