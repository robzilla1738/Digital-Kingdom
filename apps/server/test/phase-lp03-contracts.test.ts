import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, liveGraph } from "./helpers.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { provenanceOf } from "../src/provenance.ts";
import { mcpHarness } from "../../mcp/test/phase-harness.ts";
import {
  CAPABILITY_TIERS, deriveCapability, LOCAL_LAB_LABEL, schemas, SUPPORT_LEVELS, SUPPORT_TIER_OF, SURFACES, validateCapabilityReceipt, validateEventSchema,
  validateGraphSchema, validateRunProvenance, validateVerificationReceipt, validateWorldPlan, type CapabilityReceipt,
} from "@dk/contracts";

/** LP03: run provenance and capability contracts. */
const ROOT = join(import.meta.dirname, "../../..");
const PKG = join(ROOT, "docs/phases/local-intelligence/package");
const pkgJson = (p: string) => JSON.parse(readFileSync(join(PKG, p), "utf8"));
const V1: Record<string, string> = { "dk.local.world_plan.proposed.v1": "dk.local.world_plan.v1", "dk.local.verification_receipt.proposed.v1": "dk.local.verification_receipt.v1" };
/** Explicit, tested migration from the package's proposal ids to the adopted v1 ids. Nothing else changes. */
const migrateProposal = <T extends { schema: string }>(d: T): T => ({ ...d, schema: V1[d.schema] ?? d.schema });
const VALIDATORS: Record<string, (d: unknown) => { ok: boolean; errors: string[] }> = { "world-plan": validateWorldPlan, "verification-receipt": validateVerificationReceipt };
const provenance = (over: Record<string, unknown> = {}) => ({ schema: "dk.local.run_provenance.v1", run_id: "run-lp03", world_plan_id: "plan-lp03", catalog_version: "catalog-v1", execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only", external_validation: "not_performed", ...over });

describe("LP03-A1 existing synthetic/live contracts are unchanged; proposals migrate explicitly", () => {
  it("dataset_kind keeps exactly its two meanings in graph and event schemas", () => {
    expect((schemas.graph as { properties: { dataset_kind: { enum: string[] } } }).properties.dataset_kind.enum).toEqual(["synthetic", "live"]);
    expect((schemas.event as { properties: { dataset_kind: { enum: string[] } } }).properties.dataset_kind.enum).toEqual(["synthetic", "live"]);
    const g = JSON.parse(readFileSync(join(ROOT, "fixtures/demo/graph.json"), "utf8"));
    expect(validateGraphSchema(g).ok).toBe(true);
    expect(validateGraphSchema({ ...g, dataset_kind: "synthetic_local" }).ok).toBe(false);
    const ev = { schema_version: "0.2", dataset_kind: "live", id: "e1", project_id: "p", source_id: "s", received_at: "2026-10-23T10:00:00Z", source_event_id: "x", occurred_at: "2026-10-23T10:00:00Z", asset_ids: ["a"], action: "authentication", outcome: "success", evidence_refs: ["evidence:e1"] };
    expect(validateEventSchema(ev).ok).toBe(true);
    expect(validateEventSchema({ ...ev, dataset_kind: "local" }).ok).toBe(false);
    expect(validateEventSchema({ ...ev, provenance: provenance() }).ok).toBe(false); // provenance never rides on events
  });

  it("a genuine v0.3 database upgrades without gaining a local label", () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-lp03-")); const p = join(dir, "db.sqlite");
    copyFileSync(join(ROOT, "fixtures/legacy/v0.3-journal.sqlite"), p);
    const s = new Store(openDb(p));
    const proj = s.getProject("legacy")!;
    expect(proj.dataset_kind).toBe("live");
    expect(provenanceOf(proj)).toMatchObject({ local_run: false });
  });

  it("local provenance never changes dataset_kind, and an invalid stored record is not relabelled local", async () => {
    const ctx = await setup();
    for (const kind of ["live", "synthetic"] as const) {
      const r = (await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: `lab-${kind}`, name: "Lab", dataset_kind: kind, local_run: provenance() } })).json();
      expect(r).toMatchObject({ dataset_kind: kind, provenance: { local_run: true, data_origin: "synthetic_local", scope: "local_run_only" } });
    }
    expect(provenanceOf({ meta: { local_run: { ...provenance(), scope: "production" } } })).toMatchObject({ local_run: false, note: expect.stringMatching(/invalid/) });
    expect(provenanceOf({ meta: {} })).toMatchObject({ local_run: false });
  });

  it("the package's proposal examples validate only after the explicit id migration", () => {
    for (const [file, contract] of [["examples/world-plan.json", "world-plan"], ["examples/verification-receipt.json", "verification-receipt"]] as const) {
      const ex = pkgJson(file);
      expect(VALIDATORS[contract]!(ex).ok, `${file} unmigrated`).toBe(false);
      expect(VALIDATORS[contract]!(migrateProposal(ex)).errors, file).toEqual([]);
    }
  });
});

describe("LP03-A3 new contracts reject executable, credential and arbitrary-target fields", () => {
  it("the package's invalid fixtures are rejected by schema or semantics", () => {
    const cases = [...pkgJson("examples/invalid-contracts.json"), ...pkgJson("examples/invalid-semantics.json")] as { contract: string; name: string; data: { schema: string } }[];
    const adopted = cases.filter((c) => VALIDATORS[c.contract]);
    expect(adopted.length).toBeGreaterThanOrEqual(6);
    for (const c of adopted) expect(VALIDATORS[c.contract]!(migrateProposal(c.data)).ok, c.name).toBe(false);
  });

  const valid = { world: migrateProposal(pkgJson("examples/world-plan.json")), receipt: migrateProposal(pkgJson("examples/verification-receipt.json")), provenance: provenance(), capability: { schema: "dk.local.capability_receipt.v1", surface_id: "DK-S-service", level: "declared", scope: { project_id: "p", asset_id: "a" }, basis: "declared_inventory", evidence_refs: ["graph:r1#a"], recorded_at: "2026-10-23T10:00:00Z" } };
  const FORBIDDEN = ["command", "cmd", "script", "exec", "image", "url", "endpoint", "host", "port", "target_url", "token", "api_key", "password", "secret", "credential", "env", "mount"];
  const at = (o: Record<string, unknown>, path: string[], key: string): Record<string, unknown> => {
    const c = structuredClone(o); let cur: Record<string, unknown> = c;
    for (const p of path) cur = (Array.isArray(cur[p]) ? (cur[p] as Record<string, unknown>[])[0] : cur[p]) as Record<string, unknown>;
    cur[key] = "x"; return c;
  };
  it.each([
    ["world plan", validateWorldPlan, () => valid.world, [[], ["resources"], ["resources", "settings"], ["budget"]]],
    ["verification receipt", validateVerificationReceipt, () => valid.receipt, [[], ["probes"], ["cleanup"]]],
    ["run provenance", validateRunProvenance, () => valid.provenance, [[]]],
    ["capability receipt", validateCapabilityReceipt, () => valid.capability, [[], ["scope"]]],
  ] as const)("%s: valid example passes and every forbidden field at every level fails", (_n, validate, ok, paths) => {
    expect((validate as (d: unknown) => { errors: string[] })(ok()).errors).toEqual([]);
    for (const path of paths) for (const k of FORBIDDEN) expect((validate as (d: unknown) => { ok: boolean })(at(ok() as Record<string, unknown>, [...path], k)).ok, `${path.join(".")}.${k}`).toBe(false);
  });

  it("semantic rules: dependencies resolve without cycles; a receipt cannot pass without both controls or with failed cleanup", () => {
    const w = valid.world;
    expect(validateWorldPlan({ ...w, resources: [...w.resources, { ...w.resources[0], id: "auth" }] }).errors.join()).toMatch(/duplicate/);
    const r = valid.receipt;
    expect(validateVerificationReceipt({ ...r, probes: r.probes.filter((p: { expectation: string }) => p.expectation === "permitted").concat([{ ...r.probes[1], operation_id: "op-2" }]) }).errors.join()).toMatch(/prohibited and one permitted/);
    expect(validateVerificationReceipt({ ...r, cleanup: { outcome: "failed", notes: "x" } }).errors.join()).toMatch(/cleanup/);
    expect(validateVerificationReceipt({ ...r, cleanup: { outcome: "failed", notes: "x" }, overall_outcome: "fail" }).ok).toBe(true); // passed assertion + failed cleanup reported as both
    expect(validateVerificationReceipt({ ...r, probes: [{ ...r.probes[0], observer_scope: "unavailable" }, r.probes[1]] }).ok).toBe(false);
    expect(validateRunProvenance(provenance({ data_origin: "production" })).ok).toBe(false);
    expect(validateRunProvenance(provenance({ external_validation: "passed" })).ok).toBe(false);
  });
});

async function localWorld() {
  const t = await mcpHarness();
  const { app, admin, h } = t.ctx;
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "lab", name: "Lab", dataset_kind: "live", local_run: provenance() } })).statusCode).toBe(200);
  await app.inject({ method: "POST", url: "/api/projects/lab/graph", headers: h(admin), payload: liveGraph("lab") });
  await app.inject({ method: "POST", url: "/api/projects/lab/sources", headers: h(admin), payload: { id: "app", label: "app", kind: "app_security", asset_ids: ["api"], stale_after_seconds: 3600 } });
  const now = t.ctx.store.now().getTime();
  for (let i = 0; i < 6; i++) t.ctx.store.receive("lab", "app", { source_event_id: `f${i}`, occurred_at: new Date(now - 600_000 + i * 1000).toISOString(), asset_ids: ["api"], action: "authentication", outcome: "failure", actor_ref: "alice" });
  while (t.ctx.store.processBatch().processed) { /* drain */ }
  return t;
}

describe("LP03-A2 local recorded activity carries synthetic-data and local-scope qualifiers everywhere", () => {
  it("API: projects, snapshot, overview, search, event detail, recipe, bundle events and both exports", async () => {
    const t = await localWorld();
    try {
      const { app, h, viewer, analyst } = t.ctx;
      const local = (x: { provenance?: unknown }) => expect(x.provenance, JSON.stringify(x).slice(0, 200)).toMatchObject({ local_run: true, data_origin: "synthetic_local", scope: "local_run_only", qualifiers: ["synthetic_data", "local_scope"], label: LOCAL_LAB_LABEL, run_id: "run-lp03" });
      const get = async (u: string, tok = viewer) => (await app.inject({ url: u, headers: h(tok) })).json();
      local((await get("/api/projects")).find((p: { id: string }) => p.id === "lab"));
      expect((await get("/api/projects")).find((p: { id: string }) => p.id === "demo-castle").provenance).toMatchObject({ local_run: false });
      local((await get("/api/projects/lab/snapshot")).project);
      local((await get("/api/projects/lab/overview")).project);
      const search = await get(`/api/projects/lab/events/search?after=${encodeURIComponent(new Date(Date.now() - 86_400_000 * 2).toISOString())}&before=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`);
      local(search);
      expect(search.events.length).toBeGreaterThan(0);
      local(await get(`/api/projects/lab/events/${encodeURIComponent(search.events[0].id)}`));
      const f = t.ctx.store.listFindings("lab").find((x) => x.kind === "repeated_auth_failure")!;
      expect(f).toBeTruthy();
      local((await app.inject({ method: "POST", url: `/api/projects/lab/recipes/auth-burst-then-success/run`, headers: h(viewer), payload: { finding_id: f.id } })).json());
      const b = (await app.inject({ method: "POST", url: `/api/projects/lab/findings/${f.id}/bundles`, headers: h(viewer), payload: {} })).json();
      local(await get(`/api/projects/lab/bundles/${b.bundle_id}/events`));
      local((await app.inject({ method: "POST", url: `/api/projects/lab/cases/${f.id}/export`, headers: h(analyst) })).json().manifest);
      const c = (await app.inject({ method: "POST", url: "/api/projects/lab/cases", headers: h(analyst), payload: { title: "lab case", scope: { question: "?", asset_ids: ["api"] }, closure_criteria: "done" } })).json();
      local((await app.inject({ method: "POST", url: `/api/projects/lab/cases/${c.id}/export`, headers: h(analyst) })).json().manifest);
    } finally { await t.close(); }
  });

  it("MCP: overview, event search and event detail carry the same qualifiers", async () => {
    const t = await localWorld();
    try {
      const c = await t.connect(t.ctx.viewer);
      expect((await t.call(c, "dk_overview", { project: "lab" })).json.project.provenance).toMatchObject({ local_run: true, scope: "local_run_only", data_origin: "synthetic_local" });
      const s = (await t.call(c, "dk_search_events", { project: "lab", after: new Date(Date.now() - 86_400_000 * 2).toISOString(), before: new Date(Date.now() + 86_400_000).toISOString() })).json;
      expect(s.provenance).toMatchObject({ local_run: true, qualifiers: ["synthetic_data", "local_scope"] });
      expect((await t.call(c, "dk_get_event", { project: "lab", id: s.events.records[0].id })).json.provenance).toMatchObject({ local_run: true });
    } finally { await t.close(); }
  });

  it("an invalid local_run is refused at project creation", async () => {
    const ctx = await setup();
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "bad", name: "Bad", local_run: provenance({ target_url: "http://10.0.0.1/" }) } });
    expect(r.statusCode).toBe(422);
    expect(ctx.store.getProject("bad")).toBeUndefined();
  });
});

describe("LP03-A4 capability badges derive from scoped receipts only", () => {
  const scope = { project_id: "lab", asset_id: "agent-1", surface_id: "DK-S-agent" };
  const rec = (over: Partial<CapabilityReceipt> & Record<string, unknown> = {}): CapabilityReceipt => ({ schema: "dk.local.capability_receipt.v1", surface_id: "DK-S-agent", level: "instrumented", scope: { project_id: "lab", asset_id: "agent-1" }, basis: "source_delivery", evidence_refs: ["source:gw"], recorded_at: "2026-10-23T10:00:00Z", ...over } as CapabilityReceipt);
  it("a surface family registered lab_verified is only 'rendered' for an asset with no receipts", () => {
    expect(SURFACES.find((s) => s.id === "DK-S-agent")!.support).toBe("lab_verified");
    expect(deriveCapability(scope, [])).toMatchObject({ tier: "rendered", rendered: true, registry_ceiling: "local_verified" });
  });
  it("model-authored, out-of-scope and mismatched receipts are rejected and listed", () => {
    const d = deriveCapability(scope, [
      { ...rec(), produced_by: "llm", level: "local_verified" },
      rec({ level: "local_verified", basis: "control_test", scope: { project_id: "other", asset_id: "agent-1", run_id: "r" } }),
      rec({ level: "local_verified", basis: "source_delivery", scope: { project_id: "lab", asset_id: "agent-1", run_id: "r" } }),
      rec({ level: "local_verified", basis: "control_test" }),
      rec({ surface_id: "DK-S-tool" }),
      { claim: "the agent surface is verified", source: "model" },
    ]);
    expect(d.tier).toBe("rendered");
    expect(d.rejected).toHaveLength(6);
  });
  it("valid scoped receipts raise the badge, external validation stays deferred, and the registry ceiling caps it", () => {
    expect(deriveCapability(scope, [rec()]).tier).toBe("instrumented");
    expect(deriveCapability(scope, [rec(), rec({ level: "local_verified", basis: "control_test", evidence_refs: ["control:c1"], scope: { project_id: "lab", asset_id: "agent-1", run_id: "run-1" } })]).tier).toBe("local_verified");
    const ext = deriveCapability(scope, [rec({ level: "externally_verified", basis: "external_validation" })]);
    expect(ext.tier).toBe("rendered");
    expect(ext.rejected[0]!.reason).toMatch(/EXT01/);
    // DK-S-api is registry 'declared': a source receipt cannot lift it above the ceiling
    expect(deriveCapability({ ...scope, surface_id: "DK-S-api" }, [rec({ surface_id: "DK-S-api" })])).toMatchObject({ tier: "declared", note: expect.stringMatching(/capped/) });
  });
  it("support matrix: every registry level maps to exactly one of the five tiers", () => {
    expect([...CAPABILITY_TIERS]).toEqual(["rendered", "declared", "instrumented", "local_verified", "externally_verified"]);
    for (const l of SUPPORT_LEVELS) expect(CAPABILITY_TIERS).toContain(SUPPORT_TIER_OF[l]);
  });
  it("the surfaces API derives badges from project records, not the family", async () => {
    const t = await localWorld();
    try {
      const { app, h, viewer, admin } = t.ctx;
      const get = async (p: string) => (await app.inject({ url: `/api/projects/${p}/surfaces`, headers: h(viewer) })).json();
      const api = (await get("lab")).structures.find((s: { entity: { id: string } }) => s.entity.id === "api");
      expect(api.capability).toMatchObject({ tier: "instrumented", basis: expect.arrayContaining([expect.objectContaining({ basis: "source_delivery", ref: ["source:app"] })]) });
      const db = (await get("lab")).structures.find((s: { entity: { id: string } }) => s.entity.id === "db");
      expect(db.capability.tier).toBe("declared"); // declared in the graph; no source has delivered for it
      // a passing control test lifts a local-run asset to local_verified; the same record in a non-local project does not
      for (const p of ["lab", "shop"]) {
        if (p === "shop") { await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } }); await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph("shop") }); }
        const ctl = (await app.inject({ method: "POST", url: `/api/projects/${p}/controls`, headers: h(admin), payload: { id: `ctl-${p}`, name: "tenant check", kind: "other", asset_ids: ["db"], scope: "db reads", policy_version: "1" } })).json();
        expect(ctl.id, JSON.stringify(ctl)).toBe(`ctl-${p}`);
        const tr = await app.inject({ method: "POST", url: `/api/projects/${p}/controls/ctl-${p}/tests`, headers: h(admin), payload: { outcome: "pass", observer: "obs", conditions: "prohibited read refused; permitted read succeeded", evidence_refs: ["ev1"] } });
        expect(tr.statusCode, tr.body).toBe(200);
      }
      expect((await get("lab")).structures.find((s: { entity: { id: string } }) => s.entity.id === "db").capability).toMatchObject({ tier: "instrumented", note: expect.stringMatching(/capped at the registry ceiling instrumented/) }); // vault family ceiling
      const shopDb = (await get("shop")).structures.find((s: { entity: { id: string } }) => s.entity.id === "db");
      expect(shopDb.capability.basis.some((b: { level: string }) => b.level === "local_verified")).toBe(false);
      const labDb = (await get("lab")).structures.find((s: { entity: { id: string } }) => s.entity.id === "db");
      expect(labDb.capability.basis.some((b: { level: string }) => b.level === "local_verified")).toBe(true);
    } finally { await t.close(); }
  });
});
