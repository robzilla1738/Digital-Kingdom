import { test, expect } from '@playwright/test';
import { createRedesignHarness, type RedesignHarness } from './redesign-harness.ts';
let harness: RedesignHarness;
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { await harness?.close(); });

test('closing evidence preserves a subsequent search focus', async ({ page }) => {
  await page.goto(`${harness.offlineUrl}/?fixture=F01#workspace=investigate`);
  await page.locator('.findings-workspace [data-finding-id]').first().click();
  await expect(page.getByRole('button', { name: 'Close evidence pane', exact: true })).toBeVisible();
  // A user can move to search before the deferred close-focus restoration runs.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('aside.evidence button.close')!.click();
    document.querySelector<HTMLInputElement>('input.search')!.focus();
  });
  await expect(page.locator('aside.evidence')).not.toHaveAttribute('data-selection-id');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('input.search')).toBeFocused();
  await page.keyboard.type('orders');
  await expect(page.locator('input.search')).toHaveValue('orders');
  await expect(page.locator('.search-results')).toContainText('orders');
});

test('refined findings keep secondary controls discoverable and preserve filters across detail modes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${harness.offlineUrl}/?fixture=F01#workspace=investigate`);
  const workspace = page.locator('.findings-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole('group', { name: 'Finding filters' })).toBeHidden();
  await expect(workspace.locator('thead th')).toHaveCount(4);
  await expect(page.locator('.primary-nav svg.lucide')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('14px "Inter Variable"'))).toBe(true);
  await workspace.getByRole('button', { name: 'Filter findings', exact: true }).click();
  await workspace.getByLabel('Severity', { exact: true }).selectOption('high');
  const ids = await workspace.locator('[data-finding-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-finding-id')));
  expect(ids.length).toBeGreaterThan(0);
  await workspace.getByRole('button', { name: 'Filter findings', exact: true }).click();
  await workspace.getByRole('button', { name: 'More detail', exact: true }).click();
  await expect(workspace.locator('thead th')).toHaveCount(7);
  await workspace.getByRole('button', { name: 'Less detail', exact: true }).click();
  expect(await workspace.locator('[data-finding-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-finding-id')))).toEqual(ids);
  const explanation = workspace.locator('.context-note');
  await expect(explanation).not.toHaveAttribute('open', '');
  await explanation.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(explanation).toHaveAttribute('open', '');
  await expect(explanation).toContainText('Exact lookup determines evidence availability');
  expect(errors).toEqual([]);
});
