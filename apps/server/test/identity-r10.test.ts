import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { seedDemo } from "../src/seed.ts";
import { verifyIdToken, type OidcConfig } from "../src/oidc.ts";
import { recoverAdmin } from "../../../scripts/recover-admin.ts";
import { setup } from "./helpers.ts";

/** R10.1 deployment identity and secret handling. */
const ISS = "https://idp.test.example", AUD = "digital-kingdom";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256" };
const oidc: OidcConfig = { issuer: ISS, audience: AUD, jwks: { keys: [jwk as never] } };
const b64u = (o: object | Buffer) => Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString("base64url");
function idToken(claims: Record<string, unknown>, opts: { key?: KeyObject; alg?: string; kid?: string } = {}) {
  const h = b64u({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" }), p = b64u(claims);
  const s = createSign("SHA256"); s.update(`${h}.${p}`);
  return `${h}.${p}.${opts.alg === "none" ? "" : b64u(s.sign(opts.key ?? privateKey))}`;
}
const now = Math.floor(Date.now() / 1000);
const good = (sub = "u-123") => ({ iss: ISS, aud: AUD, sub, exp: now + 600, iat: now, name: "Ada" });

async function oidcApp(trustedProxies?: string[]) {
  const store = new Store(openDb(":memory:"));
  seedDemo(store);
  const admin = store.createToken("installation admin", "admin").token;
  const app = await buildApp({ store, secret: "s", demoMode: false, webDist: "/nonexistent", oidc, ...(trustedProxies ? { trustedProxies } : {}) });
  return { store, admin, app, h: (t: string) => ({ authorization: `Bearer ${t}` }) };
}

describe("R10.1 OIDC subjects", () => {
  it("verifies signature, issuer, audience and expiry; rejects alg none and foreign keys", () => {
    expect(verifyIdToken(idToken(good()), oidc).sub).toBe("u-123");
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    for (const [t, re] of [
      [idToken(good(), { key: other }), /signature/], [idToken({ ...good(), iss: "https://evil" }), /issuer/], [idToken({ ...good(), aud: "other" }), /audience/],
      [idToken({ ...good(), exp: now - 3600 }), /expired/], [idToken(good(), { alg: "none" }), /unsupported alg/], [idToken(good(), { alg: "HS256" }), /unsupported alg/], ["a.b", /malformed/],
    ] as const) expect(() => verifyIdToken(t, oidc)).toThrow(re);
  });

  it("an unmapped subject gets nothing; a mapped one gets exactly its scope; unmapping revokes live sessions", async () => {
    const { app, admin, h } = await oidcApp();
    expect((await app.inject({ method: "POST", url: "/api/session/oidc", payload: { id_token: idToken(good()) } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/oidc-subjects", headers: h(admin), payload: { subject: "u-123", name: "Ada", role: "viewer", projects: ["demo-castle"] } })).statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/api/session/oidc", payload: { id_token: idToken(good()) } });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({ url: "/api/projects/demo-castle/findings", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/projects/demo-castle/cases", headers: { cookie, "x-dk-request": "1" }, payload: {} })).statusCode).toBe(403); // viewer
    await app.inject({ method: "POST", url: "/api/oidc-subjects", headers: h(admin), payload: { subject: "u-123", remove: true } });
    expect((await app.inject({ url: "/api/projects/demo-castle/findings", headers: { cookie } })).statusCode).toBe(401);
  });
});

describe("R10.1 tokens", () => {
  it("service credentials expire by default; access survives rotation only through the new secret, with scope intact", async () => {
    const clock = { t: Date.now() };
    const ctx = await setup({ store: { now: () => new Date(clock.t) } });
    const r = (await ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(ctx.admin), payload: { name: "ci", role: "viewer", principal_type: "service", projects: ["demo-castle"] } })).json();
    expect(Date.parse(r.expires_at) - clock.t).toBe(90 * 86_400_000);
    const login = await ctx.app.inject({ method: "POST", url: "/api/session", payload: { token: r.token } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const rot = (await ctx.app.inject({ method: "POST", url: `/api/tokens/${r.id}/rotate`, headers: ctx.h(r.token) })).json();
    expect(rot.replaced).toBe(r.id);
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/findings", headers: ctx.h(r.token) })).statusCode).toBe(401); // old secret
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/findings", headers: { cookie } })).statusCode).toBe(401); // old session
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/findings", headers: ctx.h(rot.token) })).statusCode).toBe(200);
    await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "other", name: "Other", dataset_kind: "live" } });
    expect([403, 404]).toContain((await ctx.app.inject({ url: "/api/projects/other/findings", headers: ctx.h(rot.token) })).statusCode); // scope survives rotation
    clock.t += 91 * 86_400_000;
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/findings", headers: ctx.h(rot.token) })).statusCode).toBe(401); // expired
    expect((await ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(ctx.admin), payload: { name: "x", role: "viewer", expires_in_days: 999 } })).statusCode).toBe(400);
    const audit = ctx.store.listAudit(undefined, 50).map((a) => String(a.action));
    expect(audit).toEqual(expect.arrayContaining(["token.create", "token.rotate", "session.create"]));
  });

  it("logout is audited", async () => {
    const ctx = await setup();
    const login = await ctx.app.inject({ method: "POST", url: "/api/session", payload: { token: ctx.viewer } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    await ctx.app.inject({ method: "DELETE", url: "/api/session", headers: { cookie, "x-dk-request": "1" } });
    expect(ctx.store.listAudit(undefined, 20).map((a) => String(a.action))).toContain("session.delete");
  });
});

describe("R10.1 proxy boundary", () => {
  it("forwarded headers count only from a trusted proxy", async () => {
    const untrusted = await oidcApp();
    const a = await untrusted.app.inject({ method: "POST", url: "/api/session", headers: { "x-forwarded-proto": "https" }, payload: { token: untrusted.admin } });
    expect(String(a.headers["set-cookie"])).not.toMatch(/Secure/);
    const trusted = await oidcApp(["127.0.0.1"]);
    const b = await trusted.app.inject({ method: "POST", url: "/api/session", headers: { "x-forwarded-proto": "https" }, remoteAddress: "127.0.0.1", payload: { token: trusted.admin } });
    expect(String(b.headers["set-cookie"])).toMatch(/Secure/);
    const c = await trusted.app.inject({ method: "POST", url: "/api/session", headers: { "x-forwarded-proto": "https" }, remoteAddress: "10.9.9.9", payload: { token: trusted.admin } });
    expect(String(c.headers["set-cookie"])).not.toMatch(/Secure/);
  });
});

describe("R10.1 recovery and secret hygiene", () => {
  it("recovery needs filesystem access, yields a short-lived HUMAN admin and is audited", () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-rec-"));
    const s = new Store(openDb(join(dir, "digital-kingdom.db"))); s.db.close();
    const t = recoverAdmin(dir, "lost admin token after laptop wipe");
    const s2 = new Store(openDb(join(dir, "digital-kingdom.db")));
    const p = s2.authenticateToken(t.token)!;
    expect(p).toMatchObject({ role: "admin", projects: "*", principalType: "human" });
    expect(s2.listAudit(undefined, 5).some((a) => a.action === "admin.recovery")).toBe(true);
    expect(() => recoverAdmin(dir, "")).toThrow(/reason/);
    expect(() => recoverAdmin(join(dir, "nope"), "x")).toThrow(/no Digital Kingdom database/);
  });

  it("the web app never writes tokens or keys to browser storage", () => {
    const root = resolve(import.meta.dirname, "../../web/src");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
    walk(root);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(localStorage|sessionStorage)\.setItem\(([^)]{0,120})\)/g)) expect(m[2], `${f}`).not.toMatch(/token|key|secret|password|session/i);
    }
  });
});
