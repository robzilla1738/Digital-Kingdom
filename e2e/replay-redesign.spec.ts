import { test, expect } from '@playwright/test';
import { createRedesignHarness, offlineRedesign, type RedesignHarness } from './redesign-harness.ts';

let harness: RedesignHarness;
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { await harness?.close(); });

for (const view of ['graph', 'castle']) {
  test(`rapid keyboard replay scrubbing preserves the ${view} and latest navigation`, async ({ browser }) => {
    const { context, page } = await offlineRedesign(browser, harness, `?fixture=F01#view=${view}`);
    try {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const slider = page.getByRole('slider', { name: 'Replay position' });
      await slider.focus();
      await slider.press('Home');
      const start = Number(await slider.inputValue());
      for (let i = 0; i < 120; i++) await page.keyboard.press('ArrowRight');
      await expect(slider).toHaveValue(String(start + 120_000));
      await expect(page.getByTestId('timeline-mode')).toContainText('Historical replay');
      await expect(page.locator('.app')).toBeVisible();
      expect(errors).toEqual([]);
      await page.getByRole('button', { name: 'Return to latest', exact: true }).click();
      await expect(page.getByTestId('timeline-mode')).toContainText('Latest synthetic evidence');
    } finally {
      await context.close();
    }
  });
}
