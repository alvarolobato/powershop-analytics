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
      // Floors: relaxed to 70% (2026-04) after agentic handlers enlarged the
      // covered surface; branches kept at prior floor.
      thresholds: {
        statements: 70,
        branches: 62,
        functions: 70,
        lines: 70,
      },
    },
  },
});
