import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
