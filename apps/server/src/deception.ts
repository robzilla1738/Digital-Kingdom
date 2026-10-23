import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "./store.ts";

/**
 * Deception registry (roadmap R03.4). A decoy has a kind and an inert value; each PLACEMENT (where a copy was put)
 * gets its own unguessable id, so a trigger maps to the placement it came from, which is not necessarily where the
 * original compromise happened (copies propagate: backups, forks, pastes). Triggers are classified as
 * request, document_fetch, credential_use, dns_lookup or scanner_validation. The connecting address of a DNS
 * lookup is the recipient's resolver, and of a proxied request the proxy: neither is recorded as an identity.
 * Activations during a registered authorized test window are kept and annotated, never deleted. A decoy value that
 * matches a real active credential in the latest authorization snapshot is refused.
 */
export { DECEPTION_MIGRATION } from "./schema-r01.ts";

const KINDS = ["aws_access_key", "url", "document", "dns_name"] as const;
type Kind = (typeof KINDS)[number];
const TRIGGERS = ["request", "document_fetch", "credential_use", "dns_lookup", "scanner_validation"] as const;
const SCANNERS = /(trufflehog|gitleaks|ghsecretscanning|github-secret-scanning|shodan|censys|zgrab|masscan|nuclei|urlscan|safebrowsing|googlebot|bingbot|virustotal)/i;
const fp = (v: string) => `dfp_${createHash("sha256").update(`dk-decoy:${v}`).digest("hex").slice(0, 24)}`;

export class Deception {
  constructor(private readonly db: DatabaseSync, private readonly now: () => Date) {}
  private iso() { return this.now().toISOString(); }

  /** Register a decoy. Generates an inert value when none is given; refuses a value matching a real key. */
  register(projectId: string, b: Record<string, unknown>, actor: string, realKeyIds: Set<string>) {
    const kind = String(b.kind) as Kind;
    if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(", ")}`);
    const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 120) : kind;
    let value = typeof b.value === "string" ? b.value.trim() : "";
    if (kind === "aws_access_key") {
      value ||= `AKIA${randomBytes(10).toString("hex").toUpperCase().slice(0, 16)}`;
      if (!/^AKIA[A-Z0-9]{16}$/.test(value)) throw new HttpError(400, "aws_access_key decoys must look like an access key id");
      if (realKeyIds.has(value)) throw new HttpError(422, "this value is a real credential in the latest authorization snapshot; decoys must never be working secrets");
    } else value ||= randomBytes(12).toString("base64url");
    if (/-----BEGIN|PRIVATE KEY|aws_secret_access_key\s*=\s*[A-Za-z0-9/+]{40}/.test(String(b.value ?? ""))) throw new HttpError(422, "decoys must not contain secret material");
    const id = `dcy_${randomBytes(8).toString("hex")}`;
    this.db.prepare("INSERT INTO decoys (id, project_id, kind, label, value_fingerprint, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, kind, label, fp(value), this.iso(), actor);
    return { id, kind, label, value, note: "The value is shown once; only its fingerprint is stored. It grants nothing." };
  }

  place(projectId: string, decoyId: string, b: Record<string, unknown>, actor: string) {
    const d = this.db.prepare("SELECT * FROM decoys WHERE id = ? AND project_id = ?").get(decoyId, projectId) as Record<string, string> | undefined;
    if (!d) throw new HttpError(404, "decoy not found");
    if (d.retired_at) throw new HttpError(409, "the decoy is retired");
    const location = typeof b.location === "string" && b.location.trim() ? b.location.trim().slice(0, 300) : (() => { throw new HttpError(400, "location is required"); })();
    const parent = typeof b.parent_placement_id === "string" ? b.parent_placement_id : null;
    if (parent && !this.db.prepare("SELECT 1 FROM decoy_placements WHERE id = ? AND decoy_id = ?").get(parent, decoyId)) throw new HttpError(422, "parent placement does not belong to this decoy");
    const id = `plc_${randomBytes(12).toString("base64url")}`;
    this.db.prepare("INSERT INTO decoy_placements (id, decoy_id, project_id, location, asset_id, parent_placement_id, placed_at, placed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, decoyId, projectId, location, typeof b.asset_id === "string" ? b.asset_id : null, parent, this.iso(), actor);
    return { placement_id: id, decoy_id: decoyId, location, parent_placement_id: parent, trigger_path: `/ingest/decoy/${id}` };
  }

  retire(projectId: string, decoyId: string, reason: string, actor: string) {
    const r = this.db.prepare("UPDATE decoys SET retired_at = ?, retired_reason = ? WHERE id = ? AND project_id = ? AND retired_at IS NULL").run(this.iso(), `${reason.slice(0, 300)} (by ${actor})`, decoyId, projectId);
    if (!r.changes) throw new HttpError(404, "active decoy not found");
    this.db.prepare("UPDATE decoy_placements SET removed_at = ? WHERE decoy_id = ? AND removed_at IS NULL").run(this.iso(), decoyId);
    return { id: decoyId, retired: true };
  }

  testWindow(projectId: string, b: Record<string, unknown>, actor: string) {
    const s = String(b.starts_at ?? ""), e = String(b.ends_at ?? "");
    if (Number.isNaN(Date.parse(s)) || Number.isNaN(Date.parse(e)) || Date.parse(e) <= Date.parse(s) || Date.parse(e) - Date.parse(s) > 7 * 86_400_000) throw new HttpError(400, "starts_at/ends_at must be a window of at most 7 days");
    const id = `dtw_${randomBytes(6).toString("hex")}`;
    this.db.prepare("INSERT INTO decoy_test_windows (id, project_id, decoy_id, starts_at, ends_at, purpose, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, typeof b.decoy_id === "string" ? b.decoy_id : null, new Date(s).toISOString(), new Date(e).toISOString(), String(b.purpose ?? "authorized test").slice(0, 300), actor);
    return { id };
  }

  /** Record a trigger. `via` names the receiver or provider adapter; `locator` is the connecting network address. */
  activate(input: { placementId?: string; decoyValue?: string; trigger: string; observedAt?: string; via: string; locator?: string; userAgent?: string; proxied?: boolean; rawRef?: string }) {
    const p = input.placementId ? this.db.prepare("SELECT p.*, d.retired_at FROM decoy_placements p JOIN decoys d ON d.id = p.decoy_id WHERE p.id = ?").get(input.placementId) as Record<string, string> | undefined : undefined;
    const d = !p && input.decoyValue ? this.db.prepare("SELECT * FROM decoys WHERE value_fingerprint = ?").get(fp(input.decoyValue)) as Record<string, string> | undefined : undefined;
    if (!p && !d) return null; // not one of ours: callers answer identically so probing reveals nothing
    const projectId = (p?.project_id ?? d?.project_id)!, decoyId = (p?.decoy_id ?? d?.id)!;
    let trigger = TRIGGERS.includes(input.trigger as never) ? input.trigger : "request";
    if (input.userAgent && SCANNERS.test(input.userAgent)) trigger = "scanner_validation";
    const at = input.observedAt && !Number.isNaN(Date.parse(input.observedAt)) ? new Date(input.observedAt).toISOString() : this.iso();
    const win = this.db.prepare("SELECT id FROM decoy_test_windows WHERE project_id = ? AND (decoy_id IS NULL OR decoy_id = ?) AND starts_at <= ? AND ends_at >= ? LIMIT 1").get(projectId, decoyId, at, at) as { id: string } | undefined;
    const locatorKind = trigger === "dns_lookup" ? "dns_resolver" : input.proxied ? "proxy" : input.locator ? "connecting_address" : null;
    const id = `dac_${randomBytes(8).toString("hex")}`;
    this.db.prepare("INSERT INTO decoy_activations (id, project_id, placement_id, decoy_id, trigger, observed_at, received_at, via, network_locator, locator_kind, user_agent, authorized_test_window, raw_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, projectId, p?.id ?? null, decoyId, trigger, at, this.iso(), input.via.slice(0, 60), input.locator?.slice(0, 64) ?? null, locatorKind, input.userAgent?.slice(0, 200) ?? null, win?.id ?? null, input.rawRef?.slice(0, 200) ?? null);
    return { id, projectId, decoyId, placementId: p?.id ?? null, trigger, retired: !!(p?.retired_at ?? d?.retired_at), authorized_test_window: win?.id ?? null };
  }

  /** Placement lineage and every activation, with what each does and does not establish. */
  report(projectId: string, decoyId: string) {
    const d = this.db.prepare("SELECT id, kind, label, created_at, retired_at, retired_reason FROM decoys WHERE id = ? AND project_id = ?").get(decoyId, projectId) as Record<string, string> | undefined;
    if (!d) throw new HttpError(404, "decoy not found");
    const placements = this.db.prepare("SELECT id, location, asset_id, parent_placement_id, placed_at, placed_by, removed_at FROM decoy_placements WHERE decoy_id = ? ORDER BY placed_at").all(decoyId) as Record<string, string>[];
    const chain = (id: string | null): string[] => { const out: string[] = []; let cur = id; for (let i = 0; cur && i < 20; i++) { const p = placements.find((x) => x.id === cur); if (!p) break; out.unshift(String(p.location)); cur = p.parent_placement_id ?? null; } return out; };
    const activations = (this.db.prepare("SELECT * FROM decoy_activations WHERE decoy_id = ? ORDER BY observed_at").all(decoyId) as Record<string, string>[]).map((a) => ({
      id: a.id, trigger: a.trigger, observed_at: a.observed_at, via: a.via, placement_id: a.placement_id, placement_path: chain(a.placement_id ?? null),
      network_locator: a.network_locator ? { value: a.network_locator, kind: a.locator_kind, identity: false } : null, user_agent: a.user_agent,
      authorized_test: a.authorized_test_window ? { window_id: a.authorized_test_window, note: "inside a registered authorized test window; retained, not deleted" } : null,
      establishes: a.placement_id ? `the copy placed at ${chain(a.placement_id).join(" -> ")} was ${a.trigger === "credential_use" ? "used as a credential" : a.trigger === "dns_lookup" ? "resolved" : a.trigger === "document_fetch" ? "opened" : a.trigger === "scanner_validation" ? "checked by a scanner" : "requested"}` : "the decoy value was presented",
      not_established: ["who did it (a network address is a resolver, proxy or shared egress, not a person)", "where the original compromise happened (copies propagate)"],
    }));
    return { schema: "dk.decoy_report.v1", decoy: d, placements, activations };
  }
}

/** Canarytokens webhook (one existing provider). Its fields: memo, manage_url, src_ip, time, channel, additional_data. */
export function fromCanarytokens(body: Record<string, unknown>) {
  const memo = String(body.memo ?? "");
  const placement = /(?<![A-Za-z0-9_-])plc_[A-Za-z0-9_-]{16}(?![A-Za-z0-9_-])/.exec(memo)?.[0];
  const channel = String(body.channel ?? "").toUpperCase();
  const ad = (body.additional_data ?? {}) as Record<string, unknown>;
  const trigger = channel === "DNS" ? "dns_lookup" : /AWS/.test(channel) ? "credential_use" : /PDF|DOC|WORD|EXCEL/.test(channel) || String(ad.src_data ?? "").includes("document") ? "document_fetch" : "request";
  return { ...(placement ? { placementId: placement } : {}), trigger, ...(typeof body.time === "string" ? { observedAt: body.time.replace(" ", "T").replace(/( UTC)?$/, "Z").replace("ZZ", "Z") } : {}), via: "canarytokens", ...(typeof body.src_ip === "string" ? { locator: body.src_ip } : {}), ...(typeof ad.useragent === "string" ? { userAgent: ad.useragent } : {}), ...(typeof body.manage_url === "string" ? { rawRef: "canarytokens:manage_url" } : {}) };
}
