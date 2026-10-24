import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildCapsule, CapsuleRefusal, importCapsule, inspectArchive, missionRecordProblems, MISSION_TRUTH_FIELDS } from "../src/capsule.ts";
import { composeMission, draftFromScenario, missionTruthMarkers } from "../../../packages/local-world/src/index.ts";

/**
 * LP30 follow-up delivered with LP31: LP29 missions can travel in an LP28 evidence-only capsule as investigator-side
 * records (brief, truth commitment, runner-reported runs). Builder truth (seed, schedule, labels, expectations) is never
 * included: the server does not hold it, and a record carrying any builder-truth field is refused at build and import.
 * Negative cases first. No model calls.
 */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const ROOT = new URL("../../../", import.meta.url);
const lw = (id: string) => JSON.parse(readFileSync(new URL(`scenarios/local-world/dsl/${id}.scenario.json`, ROOT), "utf8"));
const req = (ctx: Ctx, method: "GET" | "POST", url: string, payload?: unknown, token = ctx.analyst) => ctx.app.inject({ method, url, headers: ctx.h(token), ...(payload !== undefined ? { payload: payload as object } : {}) });

async function missionAndCase(ctx: Ctx) {
  const draft = draftFromScenario(lw("LW-01"), "investigate");
  const composed = composeMission(draft); if (!composed.ok) throw new Error("compose");
  expect((await req(ctx, "POST", "/api/local-missions", { draft })).statusCode).toBe(201);
  // a runner-reported run (commitment-checked), so the record carries run lifecycle too
  expect((await req(ctx, "POST", `/api/local-missions/${draft.id}/runs`, { run_id: "lp31-run-1", truth_commitment: composed.brief.truth_commitment, world_revision: composed.brief.world_revision }, ctx.admin)).statusCode).toBe(201);
  expect((await req(ctx, "POST", `/api/local-missions/${draft.id}/runs/lp31-run-1/finish`, { status: "complete", accounting: { executed: [0, 1, 2] }, cleanup: { outcome: "completed", failures: [] } }, ctx.admin)).statusCode).toBe(200);
  const c = (await req(ctx, "POST", `${P}/cases`, { title: "Mission capsule case", scope: { question: "What happened?", asset_ids: ["api"] }, closure_criteria: "explained" })).json();
  return { draft, composed, caseId: c.id as string };
}

describe("LP31 mission capsules (negative first): builder truth is refused", () => {
  it("a mission record carrying any builder-truth field, or claiming stored truth, is refused at build", async () => {
    const ctx = await setup();
    const { draft, composed, caseId } = await missionAndCase(ctx);
    const exp = (await req(ctx, "POST", `${P}/cases/${caseId}/export`)).json();
    const record = (await req(ctx, "GET", `/api/local-missions/${draft.id}`, undefined, ctx.viewer)).json();
    expect(missionRecordProblems(record)).toEqual([]);
    for (const field of MISSION_TRUTH_FIELDS) {
      const bad = { ...record, brief: { ...record.brief, [field]: field === "seed" ? composed.truth.seed : [] } };
      expect(() => buildCapsule({ kind: "evidence_only", caseExport: exp, missions: [bad] }), field).toThrow(CapsuleRefusal);
      expect(() => buildCapsule({ kind: "evidence_only", caseExport: exp, missions: [bad] }), field).toThrow(/builder-truth field/);
    }
    expect(() => buildCapsule({ kind: "evidence_only", caseExport: exp, missions: [{ ...record, truth_stored_on_server: true }] })).toThrow(/truth_stored_on_server must be false/);
    expect(() => buildCapsule({ kind: "evidence_only", caseExport: exp, missions: [composed.truth] })).toThrow(/mission record refused/);
    expect(() => buildCapsule({ kind: "evidence_only", caseExport: exp, missions: [{ ...record, schema: "dk.local.mission_truth.v1" }] })).toThrow(/schema is not dk.local.mission_record.v1/);
    // the API refuses unknown and malformed mission lists before building anything
    expect((await req(ctx, "POST", `${P}/cases/${caseId}/capsule`, { mission_ids: ["no-such-mission"] })).statusCode).toBe(404);
    expect((await req(ctx, "POST", `${P}/cases/${caseId}/capsule`, { mission_ids: "x" })).statusCode).toBe(400);
  });
});

describe("LP31 mission capsules: evidence-only round trip carries the investigator view only", () => {
  it("exports a mission with its case, imports it into a fresh instance, and no builder-truth marker appears anywhere in the archive", async () => {
    const a = await setup();
    const { draft, composed, caseId } = await missionAndCase(a);
    const r = await req(a, "POST", `${P}/cases/${caseId}/capsule`, { mission_ids: [draft.id] });
    expect(r.statusCode, r.body).toBe(200);
    const cap = r.json();
    expect(cap.manifest.kind).toBe("evidence_only");
    expect(cap.manifest.entries.filter((e: { role: string }) => e.role === "mission")).toEqual([expect.objectContaining({ path: "missions/mission-1.json", role: "mission" })]);
    expect(cap.manifest.sealed).toBeNull();
    // builder truth (seed, its derived marker/hash, step labels/values, expectation labels) is nowhere in the archive
    const archive = Buffer.from(cap.archive_base64, "base64");
    const text = gunzipSync(archive).toString("utf8");
    const markers = missionTruthMarkers(composed.truth);
    expect(markers.length).toBeGreaterThan(2);
    for (const m of markers) expect(text.includes(m), `builder-truth marker leaked: ${m.slice(0, 24)}`).toBe(false);
    for (const f of MISSION_TRUTH_FIELDS) expect(new RegExp(`"${f}":\\s*[^-0-9\\s]`).test(text), f).toBe(false); // counts only
    // the commitment is present, so a later holder of the truth can be checked against it
    expect(text).toContain(composed.brief.truth_commitment);
    // import on a fresh instance: separate namespace, mission record intact, still blinded and truth-free
    const b = await setup();
    const imp = await req(b, "POST", "/api/capsules/import", { archive_base64: cap.archive_base64 }, b.admin);
    expect(imp.statusCode, imp.body).toBe(200);
    const v = imp.json();
    expect(v.missions).toHaveLength(1);
    expect(v.missions[0]).toMatchObject({ schema: "dk.local.mission_record.v1", id: draft.id, blinded: true, truth_stored_on_server: false, truth_commitment: composed.brief.truth_commitment });
    expect(v.missions[0].runs).toEqual([expect.objectContaining({ run_id: "lp31-run-1", status: "complete" })]);
    expect(b.store.db.prepare("SELECT COUNT(*) AS n FROM local_missions").get()).toEqual({ n: 0 }); // imported as capsule data only
    // tampering a mission entry to add truth is caught (digest first; a re-digested forgery is refused by content)
    const ents = inspectArchive(archive);
    const mission = ents.find((e) => e.path === "missions/mission-1.json")!;
    const forged = JSON.parse(mission.data.toString("utf8")); forged.brief.seed = composed.truth.seed;
    const { packTar } = await import("../src/capsule.ts");
    const { gzipSync } = await import("node:zlib");
    const swapped = gzipSync(packTar(ents.map((e) => (e.path === mission.path ? { path: e.path, data: Buffer.from(JSON.stringify(forged)) } : e))));
    expect(() => importCapsule(swapped)).toThrow(/does not match its manifest digest/);
  });
});
