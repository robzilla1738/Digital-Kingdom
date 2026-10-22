import { defineConfig } from "@playwright/test";

/**
 * Browser pilot. Software WebGL (SwiftShader) is requested explicitly so the 3D castle can render in
 * headless CI; the 3D test asserts a real WebGL context and non-blank pixels, and fails rather than
 * passing on the fallback. Artifacts (trace, screenshots, sanitized server log, JSON results) go to
 * artifacts/pilot/.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  outputDir: "artifacts/pilot/test-results",
  reporter: [["list"], ["json", { outputFile: "artifacts/pilot/results.json" }]],
  use: {
    viewport: { width: 1440, height: 900 },
    // tracing is started manually AFTER sign-in so the typed token is never recorded
    trace: "off",
    screenshot: "off",
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] },
  },
});
