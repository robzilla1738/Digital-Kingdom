import { validateGraphSchema, toMs, type Asset, type Graph, type Relationship } from "@dk/contracts";

export interface GraphValidationOptions {
  /** When supplied, every source/evidence reference must resolve to a known evidence record id. */
  knownEvidenceRefs?: Set<string>;
}

export interface GraphValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Schema + semantic validation of an asset graph. Never mutates input. */
export function validateGraph(input: unknown, opts: GraphValidationOptions = {}): GraphValidationResult {
  const schema = validateGraphSchema(input);
  if (!schema.ok) return { ok: false, errors: schema.errors.map((e) => "schema: " + e), warnings: [] };
  const graph = input as Graph;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const a of graph.assets) {
    if (ids.has(a.id)) errors.push(`duplicate asset id: ${a.id}`);
    ids.add(a.id);
    for (const alias of [a.name, ...(a.aliases ?? [])]) {
      const prev = aliasOwner.get(alias.toLowerCase());
      if (prev && prev !== a.id) warnings.push(`alias "${alias}" is shared by ${prev} and ${a.id}; source mapping by this alias is ambiguous`);
      else aliasOwner.set(alias.toLowerCase(), a.id);
    }
    if (opts.knownEvidenceRefs) for (const r of a.source_refs) if (!opts.knownEvidenceRefs.has(r)) errors.push(`asset ${a.id} provenance ${r} does not resolve`);
    if (a.valid_from && a.valid_to && toMs(a.valid_to) < toMs(a.valid_from)) errors.push(`asset ${a.id} valid_to precedes valid_from`);
  }
  const relIds = new Set<string>();
  for (const r of graph.relationships) {
    if (relIds.has(r.id)) errors.push(`duplicate relationship id: ${r.id}`);
    relIds.add(r.id);
    if (!ids.has(r.source_id)) errors.push(`relationship ${r.id} source ${r.source_id} is not a known asset`);
    if (!ids.has(r.target_id)) errors.push(`relationship ${r.id} target ${r.target_id} is not a known asset`);
    if (r.source_id === r.target_id) warnings.push(`relationship ${r.id} is a self-loop`);
    if (opts.knownEvidenceRefs) for (const e of r.evidence_refs) if (!opts.knownEvidenceRefs.has(e)) errors.push(`relationship ${r.id} evidence ${e} does not resolve`);
    if ((r.evidence_level === "inferred" || r.evidence_level === "hypothetical") && !r.assumptions) warnings.push(`relationship ${r.id} is ${r.evidence_level} but states no assumptions`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export class GraphIndex {
  readonly assets = new Map<string, Asset>();
  readonly relationships = new Map<string, Relationship>();
  private readonly aliases = new Map<string, string>();
  readonly outgoing = new Map<string, Relationship[]>();
  readonly incoming = new Map<string, Relationship[]>();

  constructor(readonly graph: Graph) {
    for (const a of graph.assets) {
      this.assets.set(a.id, a);
      for (const alias of [a.id, a.name, ...(a.aliases ?? [])]) {
        const k = alias.toLowerCase();
        if (!this.aliases.has(k)) this.aliases.set(k, a.id);
        else if (this.aliases.get(k) !== a.id) this.aliases.set(k, "\u0000ambiguous");
      }
    }
    for (const r of graph.relationships) {
      this.relationships.set(r.id, r);
      push(this.outgoing, r.source_id, r);
      push(this.incoming, r.target_id, r);
    }
  }

  /** Resolve a source-supplied service name/alias to a stable asset id. Ambiguous aliases resolve to nothing. */
  resolve(nameOrAlias: string | undefined | null): string | undefined {
    if (!nameOrAlias) return undefined;
    const id = this.aliases.get(nameOrAlias.toLowerCase());
    return id && id !== "\u0000ambiguous" ? id : undefined;
  }

  neighbors(assetId: string): Relationship[] {
    return [...(this.outgoing.get(assetId) ?? []), ...(this.incoming.get(assetId) ?? [])];
  }

  /** Bounded breadth-first traversal (no unbounded graph walks). */
  reachable(fromId: string, maxDepth = 4, maxNodes = 200): string[] {
    const seen = new Set([fromId]);
    let frontier = [fromId];
    for (let d = 0; d < maxDepth && frontier.length && seen.size < maxNodes; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const r of this.outgoing.get(id) ?? []) if (!seen.has(r.target_id) && seen.size < maxNodes) { seen.add(r.target_id); next.push(r.target_id); }
      frontier = next;
    }
    seen.delete(fromId);
    return [...seen];
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v); else m.set(k, [v]);
}

/**
 * Historical topology: the assets and relationships valid at a moment.
 * Tombstoned assets remain available for cases that predate their removal.
 */
export function graphAsOf(graph: Graph, atIso: string): Graph {
  const t = toMs(atIso);
  const live = (from?: string, to?: string) => (!from || toMs(from) <= t) && (!to || toMs(to) > t);
  const assets = graph.assets.filter((a) => live(a.valid_from, a.valid_to));
  const ids = new Set(assets.map((a) => a.id));
  const relationships = graph.relationships.filter((r) => live(r.valid_from, r.valid_to) && ids.has(r.source_id) && ids.has(r.target_id));
  return { ...graph, assets, relationships };
}

export interface GraphDiff {
  added: string[];
  removed: string[];
  changed: string[];
  addedRelationships: string[];
  removedRelationships: string[];
}

export function diffGraphs(prev: Graph, next: Graph): GraphDiff {
  const p = new Map(prev.assets.map((a) => [a.id, a]));
  const n = new Map(next.assets.map((a) => [a.id, a]));
  const pr = new Set(prev.relationships.map((r) => r.id));
  const nr = new Set(next.relationships.map((r) => r.id));
  return {
    added: [...n.keys()].filter((k) => !p.has(k)),
    removed: [...p.keys()].filter((k) => !n.has(k)),
    changed: [...n.keys()].filter((k) => p.has(k) && JSON.stringify(p.get(k)) !== JSON.stringify(n.get(k))),
    addedRelationships: [...nr].filter((k) => !pr.has(k)),
    removedRelationships: [...pr].filter((k) => !nr.has(k)),
  };
}
