import { defineConfig } from '@playwright/test';
const artifacts = process.env.DK_RED_ARTIFACTS ?? 'artifacts/redesign/final';
/** Supplemental redesign suite. The original pilot remains an independent regression gate. */
export default defineConfig({
  testDir: 'e2e', testMatch: /.*redesign\.spec\.ts/, timeout: 120_000, workers: 1, fullyParallel: false,
  // Cold SwiftShader compilation can block the page for >5s on shared runners.
  // Keep readiness assertions bounded and authoritative; do not retry failed tests.
  expect: { timeout: 15_000 },
  outputDir: `${artifacts}/test-results`,
  reporter: [['list'], ['json', { outputFile: `${artifacts}/results.json` }]],
  use: { actionTimeout: 10_000, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.DK_BROWSER_EXECUTABLE, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] } },
});
