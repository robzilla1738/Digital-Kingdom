import { provenanceOf } from "./provenance.ts";
import { canonicalJson, CATALOG_VERSION } from "@dk/contracts";
import { COMPILER_VERSION } from "@dk/scene-compiler";
import { PARSER_VERSION, RULESET_VERSION } from "@dk/detections";
import { GraphIndex } from "@dk/graph-core";
import { hmac, safeEqual, sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import { createBundle } from "./bundles.ts";

/**
 * Reproducible case export. The manifest digests each section; the signature (HMAC with the server's
 * secret) lets this server detect tampering relative to what it exported. It is NOT proof of completeness,
 * of the truth of source data, or of legal admissibility. Evidence is the redacted derivative stored at
 * ingestion; originals were never retained.
 */
export function exportCase(store: Store, projectId: string, findingId: string, actor: string, secret: string) {
  const detail = store.getFinding(projectId, findingId);
  if (!detail) throw new HttpError(404, "finding not found");
  const graph = store.getGraph(projectId)!;
  const ix = new GraphIndex(graph);
  const assetIds = new Set(detail.finding.affected_asset_ids);
  for (const id of [...assetIds]) for (const r of ix.neighbors(id)) { assetIds.add(r.source_id); assetIds.add(r.target_id); }
  // exact references, never a recency window: older cases export completely or say what is missing
  const ids = [...new Set([...detail.finding.event_ids, ...detail.finding.counterevidence_event_ids])];
  const events = store.eventsByIds(projectId, ids);
  const found = new Set(events.map((e) => e.id));
  const storedRefs = [...new Set(events.flatMap((e) => e.evidence_refs))].filter((r) => r.startsWith("evidence:"));
  const evidence = store.evidenceFor(projectId, storedRefs);
  const completeness = {
    expected_events: ids.length, included_events: events.length, missing_event_ids: ids.filter((i) => !found.has(i)),
    expected_evidence_records: storedRefs.length, included_evidence_records: Object.keys(evidence).length,
    missing_evidence_refs: storedRefs.filter((r) => !evidence[r]),
  };
  const scene = store.getScene(projectId);
  const evaluation = store.evaluation(projectId);
  // R01.3: the export names the immutable bundle for the exported revision, so UI, MCP and export agree.
  const bundle = createBundle(store, projectId, findingId, actor, { revision: detail.finding.revision });
  const sections = {
    finding: detail.finding,
    revisions: detail.revisions,
    analyst_notes: detail.notes,
    events,
    evidence,
    topology: { graph_revision: graph.graph_revision, assets: graph.assets.filter((a) => assetIds.has(a.id)), relationships: graph.relationships.filter((r) => assetIds.has(r.source_id) && assetIds.has(r.target_id)) },
    completeness,
    coverage: evaluation.coverage.filter((c) => c.asset_ids.some((a) => assetIds.has(a))),
    versions: { ruleset: RULESET_VERSION, parser: PARSER_VERSION, compiler: COMPILER_VERSION, catalog: CATALOG_VERSION, scene_digest: scene?.digest ?? null },
  };
  const manifest = {
    format: "digital-kingdom-case/1",
    project_id: projectId,
    dataset_kind: graph.dataset_kind,
    provenance: provenanceOf(store.getProject(projectId)!),
    finding_id: findingId,
    exported_at: store.now().toISOString(),
    exported_by: actor,
    complete: completeness.missing_event_ids.length === 0 && completeness.missing_evidence_refs.length === 0,
    bundle: { bundle_id: bundle.bundle_id, bundle_digest: bundle.bundle_digest, finding_revision: bundle.finding_revision, expires_at: bundle.expires_at, pinned: bundle.pinned },
    coverage_window: { from: events[0]?.occurred_at ?? null, to: events[events.length - 1]?.occurred_at ?? null },
    section_sha256: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha256(canonicalJson(v))])),
    guarantee: "Tamper detection relative to this server's export record. Not proof of completeness, source truth, or admissibility.",
  };
  const signature = hmac(secret, canonicalJson(manifest));
  store.audit(actor, "case.export", projectId, findingId, { events: events.length });
  return { manifest, signature, sections };
}

export function verifyCase(bundle: unknown, secret: string): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  const b = bundle as { manifest?: { section_sha256?: Record<string, string> }; signature?: string; sections?: Record<string, unknown> };
  if (!b?.manifest || !b.signature || !b.sections) return { valid: false, problems: ["not a Digital Kingdom case bundle"] };
  if (!safeEqual(hmac(secret, canonicalJson(b.manifest)), String(b.signature))) problems.push("manifest signature mismatch");
  for (const [k, expected] of Object.entries(b.manifest.section_sha256 ?? {})) {
    if (sha256(canonicalJson(b.sections[k])) !== expected) problems.push(`section "${k}" does not match its digest`);
  }
  for (const k of Object.keys(b.sections)) if (!(k in (b.manifest.section_sha256 ?? {}))) problems.push(`unexpected section "${k}"`);
  return { valid: problems.length === 0, problems };
}
