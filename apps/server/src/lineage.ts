import { createHash, createPublicKey, createVerify } from "node:crypto";

/**
 * Source-to-running-artifact lineage (roadmap R04.1).
 *
 * Links repository -> commit -> workflow -> builder -> artifact digest -> registry tag -> deployment -> runtime.
 * Provenance is an in-toto Statement (SLSA provenance v1 predicate) inside a DSSE envelope. Signatures are checked
 * against a POLICY of expected signers (key id + PEM public key) and expected issuers (the builder id in the
 * predicate); a valid signature from an unexpected signer or builder does not satisfy policy.
 * Sigstore keyless (Fulcio certificates, Rekor inclusion) is NOT implemented: such bundles are `unverified`.
 * A verified chain says the running digest was built from the stated commit by the stated builder. It does not
 * say the artifact is free of malware or vulnerabilities.
 */
export interface DsseEnvelope { payloadType: string; payload: string; signatures: { keyid?: string; sig: string }[] }
export interface ProvenancePolicy { signers: { keyid: string; publicKeyPem: string }[]; builders: string[]; repositories: string[] }
export interface LineageInput {
  repository: string; commit: string; workflow?: string;
  registry: { reference: string; tag: string; digest_at_build: string; digest_now?: string | "unknown" };
  provenance?: DsseEnvelope | null;
  deployment?: { environment: string; reference: string; at: string } | null;
  runtime?: { digest: string | "unknown"; observed_at: string; source: string } | null;
}
export type ProvenanceState = "undeclared" | "unsigned" | "unverified" | "verified";
export interface LineageReport {
  schema: "dk.lineage.v1"; provenance: ProvenanceState; reasons: string[]; drift: string[];
  links: { from: string; to: string; state: "verified" | "declared" | "observed" | "mismatch" | "unknown" }[];
  running_matches_commit: boolean | "unknown"; not_claimed: string[];
}

const PAE = (type: string, body: Buffer) => Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `), body]);
const sha = (s: string) => /^sha256:[0-9a-f]{64}$/.test(s);

export function verifyEnvelope(env: DsseEnvelope, policy: ProvenancePolicy): { ok: boolean; keyid?: string; reason: string; statement?: Record<string, any> } {
  if (env.payloadType !== "application/vnd.in-toto+json") return { ok: false, reason: `unsupported payloadType ${env.payloadType}` };
  const body = Buffer.from(env.payload, "base64");
  let statement: Record<string, any>;
  try { statement = JSON.parse(body.toString("utf8")); } catch { return { ok: false, reason: "payload is not JSON" }; }
  if (!env.signatures?.length) return { ok: false, reason: "no signatures", statement };
  for (const s of env.signatures) {
    const signer = policy.signers.find((k) => k.keyid === s.keyid);
    if (!signer) continue;
    const v = createVerify("SHA256"); v.update(PAE(env.payloadType, body));
    try { if (v.verify(createPublicKey(signer.publicKeyPem), Buffer.from(s.sig, "base64"))) return { ok: true, keyid: signer.keyid, reason: "signature verified with an expected signer", statement }; } catch { /* bad key */ }
  }
  return { ok: false, reason: env.signatures.some((s) => policy.signers.some((k) => k.keyid === s.keyid)) ? "signature does not verify" : `signed by an unexpected signer (${env.signatures.map((s) => s.keyid ?? "no keyid").join(", ")})`, statement };
}

export function evaluateLineage(input: LineageInput, policy: ProvenancePolicy): LineageReport {
  const reasons: string[] = [], drift: string[] = [];
  const links: LineageReport["links"] = [];
  const art = input.registry.digest_at_build;
  if (!sha(art)) reasons.push("build digest is not a sha256 digest");
  let state: ProvenanceState;
  if (input.provenance === undefined || input.provenance === null) { state = "undeclared"; reasons.push("no provenance attestation was supplied"); }
  else if (!input.provenance.signatures?.length) { state = "unsigned"; reasons.push("the attestation is not signed"); }
  else {
    const v = verifyEnvelope(input.provenance, policy);
    const st = v.statement;
    if (!v.ok) { state = "unverified"; reasons.push(v.reason); }
    else {
      const subjects: string[] = (st?.subject ?? []).map((x: { digest?: { sha256?: string } }) => `sha256:${x.digest?.sha256 ?? ""}`);
      const builder = st?.predicate?.runDetails?.builder?.id as string | undefined;
      const deps = (st?.predicate?.buildDefinition?.resolvedDependencies ?? []) as { uri?: string; digest?: { gitCommit?: string; sha1?: string } }[];
      const src = deps.find((d) => (d.digest?.gitCommit ?? d.digest?.sha1) === input.commit);
      const repoOk = !!src && policy.repositories.some((r) => (src.uri ?? "").includes(r)) && (src.uri ?? "").includes(input.repository);
      if (st?.predicateType !== "https://slsa.dev/provenance/v1") { state = "unverified"; reasons.push(`unsupported predicate ${String(st?.predicateType)}`); }
      else if (!builder || !policy.builders.includes(builder)) { state = "unverified"; reasons.push(`builder ${builder ?? "(none)"} is not an expected issuer`); }
      else if (!subjects.includes(art)) { state = "unverified"; reasons.push("the attestation does not name the built digest"); }
      else if (!repoOk) { state = "unverified"; reasons.push("the attestation's source is not the expected repository and commit"); }
      else { state = "verified"; reasons.push(`signed by ${v.keyid}, built by ${builder} from ${input.repository}@${input.commit.slice(0, 12)}`); }
    }
  }
  links.push({ from: `repo:${input.repository}`, to: `commit:${input.commit}`, state: "declared" });
  if (input.workflow) links.push({ from: `commit:${input.commit}`, to: `workflow:${input.workflow}`, state: "declared" });
  links.push({ from: input.workflow ? `workflow:${input.workflow}` : `commit:${input.commit}`, to: `artifact:${art}`, state: state === "verified" ? "verified" : "declared" });
  const now = input.registry.digest_now;
  if (now === undefined || now === "unknown") links.push({ from: `artifact:${art}`, to: `tag:${input.registry.reference}:${input.registry.tag}`, state: "unknown" });
  else if (now !== art) { links.push({ from: `artifact:${art}`, to: `tag:${input.registry.reference}:${input.registry.tag}`, state: "mismatch" }); drift.push(`mutable tag ${input.registry.tag} now resolves to ${now}, not the built ${art}`); }
  else links.push({ from: `artifact:${art}`, to: `tag:${input.registry.reference}:${input.registry.tag}`, state: "observed" });
  if (input.deployment) links.push({ from: `tag:${input.registry.reference}:${input.registry.tag}`, to: `deployment:${input.deployment.environment}`, state: "declared" });
  let running: boolean | "unknown" = "unknown";
  if (!input.runtime || input.runtime.digest === "unknown") { reasons.push("the running digest has not been observed; a merged fix is not proof it is deployed"); links.push({ from: `deployment:${input.deployment?.environment ?? "?"}`, to: "runtime", state: "unknown" }); }
  else {
    running = input.runtime.digest === art;
    links.push({ from: `deployment:${input.deployment?.environment ?? "?"}`, to: `runtime:${input.runtime.digest}`, state: running ? "observed" : "mismatch" });
    if (!running) drift.push(`runtime is running ${input.runtime.digest} (seen by ${input.runtime.source} at ${input.runtime.observed_at}), not the built ${art}`);
  }
  return { schema: "dk.lineage.v1", provenance: state, reasons, drift, links, running_matches_commit: state === "verified" ? running : running === true ? "unknown" : running,
    not_claimed: ["Verified provenance does not mean the artifact is free of malware or vulnerabilities.", "Sigstore keyless bundles are not verified by this implementation."] };
}

export const digestOf = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
