import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { buildApp } from "../src/app.ts";

/** LP04-A1/A2 through the API: an empty workspace (fresh database, no project, no source, no provider credential). */
async function empty() {
  const store = new Store(openDb(":memory:"));
  const viewer = store.createToken("viewer", "viewer").token;
  const app = await buildApp({ store, secret: "s", demoMode: false, webDist: "/nonexistent" });
  return { store, app, h: { authorization: `Bearer ${viewer}` } };
}

describe("LP04 local world builder API", () => {
  it("LP04-A1: an empty workspace previews all three templates; nothing is created or contacted", async () => {
    const { store, app, h } = await empty();
    expect(store.listProjects({ kind: "token", id: "x", name: "x", role: "admin", projects: [], principalType: "human" } as never)).toEqual([]);
    const cat = (await app.inject({ url: "/api/local-world/catalog", headers: h })).json();
    expect(cat.catalog_version).toBe("dk-local-catalog-1");
    expect(cat.blueprints.map((b: { id: string }) => b.id)).toEqual(["saas-storefront", "agent-workspace", "delivery-identity"]);
    const before = (store.db.prepare("SELECT (SELECT COUNT(*) FROM projects) p, (SELECT COUNT(*) FROM sources) s, (SELECT COUNT(*) FROM audit_log) a").get() as Record<string, number>);
    for (const id of ["saas-storefront", "agent-workspace", "delivery-identity"]) {
      const r = await app.inject({ method: "POST", url: "/api/local-world/preview", headers: h, payload: { blueprint: id, seed: "s1" } });
      expect(r.statusCode, r.body).toBe(200);
      const p = r.json();
      expect(p.schema).toBe("dk.local.world_preview.v1");
      expect(p.provenance.credentials).toBe("none_required");
      expect(p.layout.rooms.length).toBeGreaterThan(3);
      // deterministic through the API too
      expect((await app.inject({ method: "POST", url: "/api/local-world/preview", headers: h, payload: { blueprint: id, seed: "s1" } })).json().revision).toBe(p.revision);
    }
    const after = (store.db.prepare("SELECT (SELECT COUNT(*) FROM projects) p, (SELECT COUNT(*) FROM sources) s, (SELECT COUNT(*) FROM audit_log) a").get() as Record<string, number>);
    expect(after).toEqual(before);
    expect((await app.inject({ method: "POST", url: "/api/local-world/preview", headers: h, payload: { blueprint: "aws-account" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/local-world/preview", payload: { blueprint: "saas-storefront" } })).statusCode).toBe(401);
  });

  it("LP04-A2: a descriptor preview through the API reports rejected and ignored fields and creates nothing", async () => {
    const { app, h } = await empty();
    const r = await app.inject({ method: "POST", url: "/api/local-world/preview", headers: h, payload: { descriptor: { format: "compose", text: "services:\n  api:\n    image: x\n    command: [sh, -c, 'curl http://169.254.169.254']\n    labels: { dk.kind: service }\n" } } });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.ok).toBe(true);
    expect(p.ignored).toContainEqual({ path: "/services/api/command", reason: "commands are never executed" });
    const remote = (await app.inject({ method: "POST", url: "/api/local-world/preview", headers: h, payload: { descriptor: { format: "openapi", text: '{"openapi":"3.1.0","paths":{"/a":{"$ref":"https://evil.example/p.json"}}}' } } })).json();
    expect(remote.ok).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/local-world/preview", headers: h, payload: { descriptor: { format: "dockerfile", text: "RUN x" } } })).statusCode).toBe(400);
  });
});
