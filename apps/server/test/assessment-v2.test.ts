import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./helpers.ts";

/**
 * dk.change_assessment.v2: target resolution and evidence sufficiency are separate, and missing, offline or
 * stale telemetry for a target can never yield a favorable posture. Uses the frozen v1 fixtures s5 (stale
 * database audit, offline runtime sensor, unobserved bucket, healthy request log) and s6 (severe decoy).
 */
type Ctx = Awaited<ReturnType<typeof setup>>;
const SCEN = join(import.meta.dirname, "../../../eval/scenarios/v1");
const spec = (name: string) => JSON.parse(readFileSync(join(SCEN, `${name}.json`), "utf8"));

async function loadCase(name: string) {
  const clock = { t: Date.parse("2026-10-19T15:00:00Z") };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const s = spec(name);
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: s.project_id, name: s.project_name, dataset_kind: "live" } });
  await app.inject({ method: "POST", url: `/api/projects/${s.project_id}/graph?format=manifest&revision=r1`, headers: { ...h(admin), "content-type": "application/yaml" }, payload: s.manifest });
  for (const src of s.sources) {
    const key = (await app.inject({ method: "POST", url: `/api/projects/${s.project_id}/sources`, headers: h(admin), payload: src })).json().key as string;
    const evs = s.events.filter((e: any) => e.source === src.id).map((e: any) => e.body);
    if (evs.length) await app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: { events: evs } });
  }
  while (ctx.store.processBatch().processed) { /* drain */ }
  clock.t += 60_000; // past the 3 s staleness window of the database audit
  return { ctx, p: s.project_id as string };
}
const assess = async (ctx: Ctx, p: string, body: Record<string, unknown>) => {
  const r = await ctx.app.inject({ method: "POST", url: `/api/projects/${p}/assess-change`, headers: ctx.h(ctx.viewer), payload: body });
  expect(r.statusCode).toBe(200);
  return r.json();
};

describe("change assessment v2", () => {
  it("healthy telemetry and nothing recorded -> favorable, with both checks passing", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const r = await assess(ctx, p, { asset_ids: ["quotes-api"] });
    expect(r.schema).toBe("dk.change_assessment.v2");
    expect(r.assessment_complete).toBeUndefined(); // v1 field removed
    expect(r.posture).toBe("no_recorded_concerns");
    expect(r).toMatchObject({ favorable: true, target_resolution: { complete: true, resolved: 1 }, evidence_sufficiency: { sufficient: true, insufficient_targets: [] } });
  });
  it("unrelated stale/offline sources elsewhere in the project do not block a healthy target", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const cov = ctx.store.evaluation(p).coverage;
    expect(cov.some((c) => c.state !== "healthy")).toBe(true); // the project does have gaps elsewhere
    expect((await assess(ctx, p, { asset_ids: ["quotes-api"] })).evidence_sufficiency.sufficient).toBe(true);
  });
  it("stale telemetry for the target -> insufficient_context (was proceed_with_care + complete in v1)", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const r = await assess(ctx, p, { asset_ids: ["records-db"] });
    expect(r.posture).toBe("insufficient_context");
    expect(r.favorable).toBe(false);
    expect(r.target_resolution.complete).toBe(true);
    expect(r.evidence_sufficiency.sufficient).toBe(false);
    expect(r.evidence_sufficiency.insufficient_targets[0]).toMatchObject({ asset_id: "records-db", reasons: [{ state: "stale" }] });
    expect(r.recommendations[0]).toMatch(/Restore telemetry for records-db/);
  });
  it("offline telemetry for the target -> insufficient_context", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const r = await assess(ctx, p, { asset_ids: ["sync-worker"] });
    expect(r.posture).toBe("insufficient_context");
    expect(r.evidence_sufficiency.insufficient_targets[0].reasons.map((x: any) => x.state)).toContain("offline");
  });
  it("unobserved target (no covering source) -> insufficient_context", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const r = await assess(ctx, p, { asset_ids: ["exports-bucket"] });
    expect(r.posture).toBe("insufficient_context");
    expect(r.evidence_sufficiency.insufficient_targets[0]).toMatchObject({ asset_id: "exports-bucket", reasons: [{ source_id: null, state: "unobserved" }] });
  });
  it("mixed healthy and degraded targets -> insufficient_context naming only the degraded ones", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const r = await assess(ctx, p, { asset_ids: ["quotes-api", "records-db", "sync-worker", "exports-bucket"] });
    expect(r.posture).toBe("insufficient_context");
    expect(r.evidence_sufficiency.insufficient_targets.map((x: any) => x.asset_id).sort()).toEqual(["exports-bucket", "records-db", "sync-worker"]);
    expect(r.targets.find((t: any) => t.asset.id === "quotes-api").evidence_sufficient).toBe(true);
  });
  it("unknown target alongside a healthy one -> insufficient_context; resolution incomplete, evidence for the resolved one sufficient", async () => {
    const { ctx, p } = await loadCase("s5-visibility-gaps-a");
    const r = await assess(ctx, p, { asset_ids: ["quotes-api", "quotes-apl"] });
    expect(r.posture).toBe("insufficient_context");
    expect(r).toMatchObject({ target_resolution: { complete: false, resolved: 1, unresolved: 1 }, evidence_sufficiency: { sufficient: true } });
    const none = await assess(ctx, p, { asset_ids: ["quotes-apl"] });
    expect(none).toMatchObject({ posture: "not_assessed", favorable: false, evidence_sufficiency: { sufficient: false } });
  });
  it("a severe finding still holds, and evidence gaps remain visible beside it", async () => {
    const { ctx, p } = await loadCase("s6-honeytoken-a");
    const r = await assess(ctx, p, { asset_ids: ["ci-vault", "inventory-svc"] });
    expect(r.posture).toBe("hold");
    expect(r.blocking_findings.map((f: any) => f.kind)).toContain("decoy_credential_used");
    expect(r.evidence_sufficiency.sufficient).toBe(false);
    expect(r.evidence_sufficiency.insufficient_targets.map((x: any) => x.asset_id)).toEqual(["inventory-svc"]);
  });
});
