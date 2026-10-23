/**
 * Contextual vulnerability applicability (roadmap R04.2).
 *
 * Inputs: SBOMs (CycloneDX-style component lists keyed by artifact digest), a cached OSV feed snapshot, KEV and
 * EPSS as separate GLOBAL context, and VEX statements with provenance. Output keeps distinct questions apart:
 *   applicability    is the vulnerable version in the RUNNING artifact (by digest), only in source, or unknown
 *   exploitation     KEV/EPSS describe the world, never this installation
 *   observed         only recorded events in Digital Kingdom can say exploitation was observed here
 *   remediation      verified only when the running digest's SBOM shows a fixed version
 * Every priority line cites the asset, digest and assumptions behind it.
 */
export interface Component { purl: string; version?: string }
export interface Sbom { artifact_digest: string; components: Component[]; generated_at: string; tool: string }
export interface OsvRange { type: "SEMVER" | "ECOSYSTEM"; events: ({ introduced: string } | { fixed: string } | { last_affected: string })[] }
export interface OsvRecord { id: string; aliases?: string[]; summary?: string; modified: string; affected: { package: { ecosystem: string; name: string; purl?: string }; ranges?: OsvRange[]; versions?: string[] }[] }
export interface FeedSnapshot { osv: OsvRecord[]; osv_fetched_at: string; kev?: { cve: string; date_added: string }[]; kev_fetched_at?: string; epss?: Record<string, number>; epss_date?: string }
export interface Vex { vulnerability: string; product_digest: string; status: "not_affected" | "affected" | "fixed" | "under_investigation"; justification?: string; author: string; signed: boolean; reviewed_by?: string }
export interface Deployed { asset_id: string; running_digest: string | "unknown"; source_commit?: string; exposure: "public" | "internal" | "unknown"; authority?: string }

export type Applicability = "affected_in_runtime" | "source_only" | "not_affected" | "fixed_in_runtime" | "unknown";
export interface Finding {
  vulnerability: string; aliases: string[]; component: string; installed_version: string | null; asset_id: string; running_digest: string | "unknown";
  applicability: Applicability; qualifications: string[];
  exploitation_context: { kev: boolean; epss: number | null; note: string };
  observed_exploitation: "not_assessed"; remediation: "verified_in_runtime" | "unverified" | "not_applicable";
  priority: "high" | "medium" | "low" | "informational"; explanation: string; assumptions: string[];
}

const STALE_MS = 7 * 86_400_000;
const nameOf = (purl: string) => { const m = /^pkg:([a-z]+)\/(.+?)(@([^?#]+))?([?#].*)?$/.exec(purl); return m ? { type: m[1]!, name: decodeURIComponent(m[2]!), version: m[4] ? decodeURIComponent(m[4]) : undefined, qualifiers: m[5] ?? "" } : null; };
const ECO: Record<string, string> = { npm: "npm", pypi: "PyPI", golang: "Go", maven: "Maven", deb: "Debian", rpm: "Red Hat", gem: "RubyGems", cargo: "crates.io" };

function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.+-]/), pb = b.replace(/^v/, "").split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0", y = pb[i] ?? "0";
    const nx = Number(x), ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) { if (nx !== ny) return nx < ny ? -1 : 1; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
/** null = cannot decide (missing version or unsupported range semantics). */
function inRange(version: string | undefined, a: OsvRecord["affected"][number]): boolean | null {
  if (!version) return null;
  if (a.versions?.includes(version)) return true;
  for (const r of a.ranges ?? []) {
    if (r.type !== "SEMVER" && r.type !== "ECOSYSTEM") continue;
    let affected = false, decided = false;
    for (const e of r.events) {
      if ("introduced" in e) { if (e.introduced === "0" || cmp(version, e.introduced) >= 0) { affected = true; decided = true; } }
      else if ("fixed" in e) { if (affected && cmp(version, e.fixed) >= 0) affected = false; }
      else if ("last_affected" in e) { if (affected && cmp(version, e.last_affected) > 0) affected = false; }
    }
    if (decided && affected) return true;
  }
  return (a.ranges?.length || a.versions?.length) ? false : null;
}

export function assess(input: { deployed: Deployed[]; sboms: Sbom[]; sourceSbom?: Sbom; feed: FeedSnapshot; vex?: Vex[]; now: Date }): { findings: Finding[]; feed: { osv_age_days: number; stale: boolean; kev_present: boolean }; limits: string[] } {
  const out: Finding[] = [];
  const osvAge = input.now.getTime() - Date.parse(input.feed.osv_fetched_at);
  const stale = osvAge > STALE_MS;
  const kev = new Set((input.feed.kev ?? []).map((k) => k.cve));
  for (const d of input.deployed) {
    const runtime = d.running_digest === "unknown" ? undefined : input.sboms.find((s) => s.artifact_digest === d.running_digest);
    const comps = new Map<string, { comp: Component; where: "runtime" | "source" }>();
    for (const c of input.sourceSbom?.components ?? []) comps.set(nameOf(c.purl)?.name ?? c.purl, { comp: c, where: "source" });
    for (const c of runtime?.components ?? []) comps.set(nameOf(c.purl)?.name ?? c.purl, { comp: c, where: "runtime" });
    for (const { comp, where } of comps.values()) {
      const p = nameOf(comp.purl); if (!p) continue;
      const version = comp.version ?? p.version;
      for (const v of input.feed.osv) for (const a of v.affected) {
        if (a.package.ecosystem !== ECO[p.type] || a.package.name !== p.name) continue;
        const hit = inRange(version, a);
        const runtimeComp = runtime?.components.find((c) => nameOf(c.purl)?.name === p.name);
        const runtimeVer = runtimeComp ? (runtimeComp.version ?? nameOf(runtimeComp.purl)?.version) : undefined;
        const runtimeHit = runtimeComp ? inRange(runtimeVer, a) : false;
        const srcComp = input.sourceSbom?.components.find((c) => nameOf(c.purl)?.name === p.name);
        const sourceHit = srcComp ? inRange(srcComp.version ?? nameOf(srcComp.purl)?.version, a) : false;
        if (hit === false && runtimeHit === false && sourceHit !== true) continue;
        const q: string[] = [];
        const assumptions: string[] = [`SBOM ${runtime ? `${runtime.tool} for ${runtime.artifact_digest.slice(0, 19)}` : "for the running digest is missing"}`, `OSV snapshot ${input.feed.osv_fetched_at}`];
        let app: Applicability;
        const vexes = (input.vex ?? []).filter((x) => (x.vulnerability === v.id || v.aliases?.includes(x.vulnerability)) && x.product_digest === d.running_digest);
        const trusted = vexes.find((x) => x.signed && x.reviewed_by);
        if (d.running_digest === "unknown" || !runtime) { app = "unknown"; q.push(d.running_digest === "unknown" ? "the running digest is unknown" : "no SBOM for the running digest"); }
        else if (!runtimeComp) { app = where === "source" ? "source_only" : "unknown"; q.push("present in the source dependency list but not in the running artifact"); }
        else if (runtimeHit === null) { app = "unknown"; q.push("installed version is missing or not comparable"); }
        else if (runtimeHit === false) app = "fixed_in_runtime";
        else app = "affected_in_runtime";
        if ((p.type === "deb" || p.type === "rpm") && app === "affected_in_runtime") { app = "unknown"; q.push("distribution packages may carry backported fixes without a version change; check the distribution advisory"); }
        if (trusted?.status === "not_affected" && app === "affected_in_runtime") { app = "not_affected"; q.push(`VEX not_affected by ${trusted.author}, reviewed by ${trusted.reviewed_by}: ${trusted.justification ?? "no justification"}`); }
        for (const x of vexes.filter((x) => x !== trusted)) q.push(`VEX from ${x.author} ignored: ${x.signed ? "not reviewed" : "unsigned"}`);
        if (stale) q.push(`feed is ${Math.round(osvAge / 86_400_000)} days old; newer advisories or fixes may exist`);
        const isKev = [v.id, ...(v.aliases ?? [])].some((id) => kev.has(id));
        const epss = [v.id, ...(v.aliases ?? [])].map((id) => input.feed.epss?.[id]).find((x) => typeof x === "number") ?? null;
        const priority: Finding["priority"] = app === "affected_in_runtime" ? (d.exposure === "public" && (isKev || (epss ?? 0) >= 0.1) ? "high" : d.exposure === "public" || isKev ? "medium" : "low") : app === "unknown" ? (isKev ? "medium" : "low") : "informational";
        out.push({
          vulnerability: v.id, aliases: v.aliases ?? [], component: p.name, installed_version: (runtimeVer ?? version) ?? null, asset_id: d.asset_id, running_digest: d.running_digest,
          applicability: app, qualifications: q,
          exploitation_context: { kev: isKev, epss, note: "KEV and EPSS describe exploitation elsewhere; they do not mean this installation is compromised." },
          observed_exploitation: "not_assessed", remediation: app === "fixed_in_runtime" ? "verified_in_runtime" : app === "affected_in_runtime" ? "unverified" : "not_applicable",
          priority, explanation: `${p.name}@${runtimeVer ?? version ?? "?"} on ${d.asset_id} (${d.exposure} exposure${d.authority ? `, ${d.authority}` : ""}) running ${String(d.running_digest).slice(0, 19)}: ${app.replace(/_/g, " ")}${isKev ? "; listed in KEV" : ""}${epss !== null ? `; EPSS ${epss}` : ""}`,
          assumptions,
        });
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2, informational: 3 };
  return { findings: out.sort((a, b) => rank[a.priority] - rank[b.priority]), feed: { osv_age_days: Math.round(osvAge / 86_400_000), stale, kev_present: !!input.feed.kev }, limits: ["Reachability of the vulnerable code is not analyzed.", "Observed exploitation is not assessed here; search events for that.", "Feeds are cached snapshots supplied to Digital Kingdom; it does not fetch them."] };
}
