import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "examples/**/*.test.ts", "apps/web/src/**/*.test.ts", "eval/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000
  }
});
