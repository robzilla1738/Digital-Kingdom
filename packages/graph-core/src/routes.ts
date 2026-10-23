import { HTTP_METHODS, type Asset, type DeclaredRoute, type Graph, type HttpMethod } from "@dk/contracts";

/**
 * Route identity and the declared route inventory (roadmap R00.3).
 *
 * A path alone does not identify an owner: `/login` can exist on several services, hosts or environments.
 * A route query therefore carries method, host and environment when the caller knows them, and resolution
 * reports every matching asset instead of choosing one.
 */
export interface RouteQuery {
  path: string;
  method?: HttpMethod;
  host?: string;
  environment?: string;
}

/** Parse "[METHOD ][scheme://][host]/path[?query]" into a route query. Returns null for unusable input. */
export function parseRouteTarget(input: string, environment?: string): RouteQuery | null {
  const s = input.trim();
  if (!s || s.length > 300) return null;
  const m = /^(?:([A-Za-z]+)\s+)?(?:[a-z][a-z0-9+.-]*:\/\/)?([A-Za-z0-9.-]+(?::\d{1,5})?)?(\/[^\s]*)$/.exec(s);
  if (!m) return null;
  const method = m[1]?.toUpperCase();
  if (method && !(HTTP_METHODS as readonly string[]).includes(method)) return null;
  const path = normalizePath(m[3]!);
  return { path, ...(method ? { method: method as HttpMethod } : {}), ...(m[2] ? { host: m[2].toLowerCase() } : {}), ...(environment ? { environment } : {}) };
}

export function normalizePath(p: string): string {
  const noQuery = p.split(/[?#]/, 1)[0]!;
  const collapsed = noQuery.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

/** Does a declared path template cover a concrete or templated path? */
export function templateMatches(template: string, path: string): boolean {
  const t = normalizePath(template).split("/").slice(1);
  const p = normalizePath(path).split("/").slice(1);
  for (let i = 0; i < t.length; i++) {
    const seg = t[i]!;
    if (seg === "*" && i === t.length - 1) return p.length >= t.length - 1;
    if (i >= p.length) return false;
    if (/^\{[^}]+\}$/.test(seg) || /^:[^/]+$/.test(seg)) { if (!p[i]) return false; continue; }
    if (seg !== p[i]) return false;
  }
  return t.length === p.length;
}

const hostMatches = (declared: string, host: string) =>
  declared.startsWith("*.") ? host.endsWith(declared.slice(1)) && host.length > declared.length - 1 : declared.toLowerCase() === host;

export interface DeclaredRouteMatch {
  asset_id: string;
  environment: string;
  route: DeclaredRoute;
}

/**
 * Every active asset whose declared routes cover the query. Unspecified method/host on either side means
 * "any": an unqualified query therefore returns all owners of that path, which is the point.
 */
export function matchDeclaredRoutes(graph: Graph, q: RouteQuery): DeclaredRouteMatch[] {
  const out: DeclaredRouteMatch[] = [];
  for (const a of graph.assets as Asset[]) {
    if (a.lifecycle === "tombstoned" || !a.routes?.length) continue;
    if (q.environment && a.environment !== q.environment) continue;
    const hit = a.routes.find((r) => templateMatches(r.path, q.path)
      && (!q.method || !r.methods || r.methods.includes(q.method))
      && (!q.host || !r.hosts || r.hosts.some((h) => hostMatches(h, q.host!))));
    if (hit) out.push({ asset_id: a.id, environment: a.environment, route: hit });
  }
  return out;
}

/** True when any asset in the graph declares a route inventory (used to explain "not in inventory"). */
export function hasRouteInventory(graph: Graph): boolean {
  return graph.assets.some((a) => !!(a as Asset).routes?.length);
}
