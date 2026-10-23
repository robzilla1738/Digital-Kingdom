import type { SecurityEvent } from "@dk/contracts";

/**
 * Typed, namespaced correlation identities (roadmap R00.2).
 *
 * A raw identifier string such as `admin` or `run-77` only means something inside the authority that
 * issued it. Two sources can both report `actor_ref: admin` for unrelated principals, an account
 * identifier can equal an unrelated session handle, and two agent runtimes can reuse the same run id.
 * Rules therefore never join on the bare string. They join on a correlation identity:
 *
 *   project + namespace + reference type + value
 *
 * The namespace comes from the server-side source declaration, never from the event payload:
 *   - `identity_namespace` covers actor_ref and session_ref (for example the identity provider that
 *     issues accounts and sessions, shared by the sign-in log and an application that accepts its
 *     sessions);
 *   - `run_namespace` covers run_id (the agent runtime that issues run ids, shared by its tool wrapper
 *     and an observer that receives the propagated run id).
 * An undeclared source gets its own private namespace `source:<id>`, so two sources only correlate
 * when an administrator explicitly declared a common authority for them. Trusted request ids keep
 * their existing contract (both events must carry request_id_trust: trusted).
 */
export type CorrelationRefType = "actor" | "session" | "run";

export interface CorrelationIdentity {
  project_id: string;
  namespace: string;
  type: CorrelationRefType;
  value: string;
}

export interface NamespaceDeclaration {
  id: string;
  identity_namespace?: string;
  run_namespace?: string;
}

const NAMESPACE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\/-]{0,95}$/;

/** Server-side validation for an administrator-declared namespace. Returns an error message or null. */
export function validateNamespace(ns: unknown): string | null {
  if (ns === undefined || ns === null || ns === "") return null;
  if (typeof ns !== "string" || !NAMESPACE_RE.test(ns)) return "namespace must be 1-96 characters of letters, digits and _ . : / -";
  if (ns.startsWith("source:")) return "the source: prefix is reserved for undeclared, per-source namespaces";
  return null;
}

export interface Namespaces {
  /** Namespace for actor_ref/session_ref reported by a source. */
  identity(sourceId: string): string;
  /** Namespace for run_id reported by a source. */
  run(sourceId: string): string;
  /** Whether the source declared any shared namespace (for disclosure text). */
  declared(sourceId: string, kind: "identity" | "run"): boolean;
}

export function namespaces(sources: NamespaceDeclaration[] | undefined): Namespaces {
  const m = new Map((sources ?? []).map((s) => [s.id, s]));
  return {
    identity: (id) => m.get(id)?.identity_namespace || `source:${id}`,
    run: (id) => m.get(id)?.run_namespace || `source:${id}`,
    declared: (id, kind) => !!(kind === "identity" ? m.get(id)?.identity_namespace : m.get(id)?.run_namespace),
  };
}

export function identityOf(e: SecurityEvent, type: CorrelationRefType, ns: Namespaces): CorrelationIdentity | null {
  const value = type === "actor" ? e.actor_ref : type === "session" ? e.session_ref : e.run_id;
  if (!value) return null;
  return { project_id: e.project_id, namespace: type === "run" ? ns.run(e.source_id) : ns.identity(e.source_id), type, value };
}

export function sameIdentity(a: CorrelationIdentity | null, b: CorrelationIdentity | null): boolean {
  return !!a && !!b && a.project_id === b.project_id && a.namespace === b.namespace && a.type === b.type && a.value === b.value;
}

export function identityKey(i: CorrelationIdentity): string {
  return `${i.project_id}\u0000${i.namespace}\u0000${i.type}\u0000${i.value}`;
}
