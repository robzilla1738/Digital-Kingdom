/** R01.2 historical coverage and R03.1 cases in the browser (isolated synthetic server). */
import { test, expect } from "@playwright/test";
import { createRedesignHarness, loginRedesign, type RedesignHarness } from "./redesign-harness.ts";

let harness: RedesignHarness;
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { await harness?.close(); });

test("CASE-01: create a case, link a finding, answer its question and close it; the finding stays independent", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.getByRole("button", { name: "Investigate", exact: true }).click();
    await page.getByRole("tab", { name: "Cases", exact: true }).click();
    await expect(page.getByLabel("Cases workspace")).toContainText("No cases yet.");
    await page.getByLabel("Case title").fill("Synthetic checkout review");
    await page.getByLabel("Case question").fill("Did anything reach the database?");
    await page.getByLabel("Closure criteria").fill("Every database read in scope is explained.");
    await page.getByRole("button", { name: "Create case", exact: true }).click();
    const detail = page.getByTestId("case-detail");
    await expect(detail).toContainText("Synthetic checkout review");
    await page.getByLabel("Case item kind").selectOption("finding");
    await page.getByLabel("Finding to link").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Add to case", exact: true }).click();
    await expect(detail).toContainText("linked at revision");
    await page.getByLabel("Case item kind").selectOption("question");
    await page.getByLabel("Case item text").fill("Which identity issued the reads?");
    await page.getByRole("button", { name: "Add to case", exact: true }).click();
    await expect(detail).toContainText("Which identity issued the reads?");
    await page.getByLabel("Closure statement").fill("Reads explained by the synthetic export job.");
    await page.getByRole("button", { name: "Close case", exact: true }).click();
    await expect(page.getByLabel("Cases workspace").getByRole("status")).toContainText("question(s) are still open");
    await page.getByLabel("Answer status").selectOption("accepted_unresolved");
    await page.getByLabel("Answer", { exact: true }).fill("No identity telemetry on the synthetic database.");
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(detail).toContainText("accepted_unresolved");
    await page.getByLabel("Closure statement").fill("Reads explained by the synthetic export job.");
    await page.getByRole("button", { name: "Close case", exact: true }).click();
    await expect(detail).toContainText("Status closed");
    await expect(page.getByRole("button", { name: "Reopen case", exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("COV-01: the historical coverage question returns spans with reasons", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.getByRole("button", { name: "Coverage", exact: true }).click();
    await page.getByRole("tab", { name: "Historical question", exact: true }).click();
    const panel = page.getByTestId("historical-coverage");
    await panel.getByLabel("Historical coverage asset").selectOption("db");
    await panel.getByLabel("Historical coverage activity").selectOption("data_access");
    await panel.getByLabel("Historical coverage start (UTC)").fill("2026-10-20T13:00");
    await panel.getByLabel("Historical coverage end (UTC)").fill("2026-10-20T16:00");
    await panel.getByRole("button", { name: "Check coverage", exact: true }).click();
    await expect(panel.getByRole("region", { name: "Coverage spans" })).toBeVisible();
    await expect(panel).toContainText("% unknown");
    await expect(panel).toContainText("not proof that anything was recorded");
  } finally { await context.close(); }
});

test("CONN-01: connector manifests show supported versions and verification levels, collect-only", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.getByRole("button", { name: "Integrations", exact: true }).click();
    await page.getByRole("tab", { name: "Connectors", exact: true }).click();
    const catalog = page.getByTestId("connector-catalog");
    await expect(catalog.getByRole("article")).toHaveCount(4);
    await expect(catalog.getByLabel("Connector OpenTelemetry traces (OTLP/HTTP JSON)")).toContainText("Other versions and encodings are not supported");
    await expect(catalog).toContainText("Lab verified");
    await expect(catalog).not.toContainText("Live verified");
    await expect(catalog).toContainText("Authority: collect only");
  } finally { await context.close(); }
});

test("CTL-01: Coverage → Controls shows an honest empty state and never implies a tested control", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.getByRole("button", { name: "Coverage", exact: true }).click();
    await page.getByRole("tab", { name: "Controls", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Controls" });
    await expect(panel).toContainText("No controls declared.");
    await expect(panel).toContainText("A drawn shield is never a tested control.");
  } finally { await context.close(); }
});
