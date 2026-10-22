import { defineConfig } from '@playwright/test';
/** Supplemental redesign suite. The original pilot remains an independent regression gate. */
export default defineConfig({
  testDir: 'e2e', testMatch: /.*redesign\.spec\.ts/, timeout: 120_000, workers: 1, fullyParallel: false,
  outputDir: 'artifacts/redesign/final/test-results',
  reporter: [['list'], ['json', { outputFile: 'artifacts/redesign/final/results.json' }]],
  use: { actionTimeout: 10_000, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, trace: 'off', screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] } },
});
