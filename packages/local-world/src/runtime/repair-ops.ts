import { REPAIR_ACTION_PARAMETER, type RepairAction, type RepairActionType } from "@dk/contracts";
import { BENCH_DISTRACTOR_POLICY_REF, grantRef } from "./lease.ts";

/**
 * LP21: the five reviewed typed repair operations, as the supervisor executes them inside one run.
 *
 * This table is the whole of what a leased controller can cause. Each entry resolves its reference against the
 * run's own state, says what "already in the desired state" means (for idempotency and crash reconciliation),
 * applies the change through one fixed, declared operation of the target's template, and states its compensation.
 * There is no shell, no URL, no path, no process id and no generic configuration write: requests go only to the
 * run's registered listeners on routes fixed here (and checked again against the template catalog by the run).
 *
 * Compensation never restores compromised authority: a deactivated test token stays deactivated, a removed grant
 * stays removed, a previously deployed (suspect) artifact is not re-selected, and a gateway policy is restored only
 * to a reviewed variant (never to the deliberately weak one). Those are recorded as `not_restored` with the reason.
 */
export interface OpHost {
  template(id: string): string | undefined;
  state(id: string): Record<string, unknown> | null;
  observerUp(id: string): boolean | undefined;
  /** POST to a declared route of a registered listener of this run, as the controller (never stimulus). */
  send(resource: string, path: string, body: unknown): Promise<{ status: number; op_id: string }>;
  reconfigure(id: string, variant: "baseline" | "candidate" | "bench_overbroad" | "bench_residual" | "bench_misbound"): void;
  /** li-next D: benchmark distractor policy variants accepted on this run's supervisor (default false). */
  distractorVariants?(): boolean;
  restartObserver(id: string): void;
}
export type Pre = Record<string, string | null>;
export type Compensation = { outcome: "restored_previous" | "not_restored" | "not_needed" | "failed"; reason: string };
interface TypedOperation {
  resolve(h: OpHost, ref: string, target: string): string | null; // null = resolvable; otherwise the reason it is not
  desired(h: OpHost, ref: string, target: string): boolean;
  capture(h: OpHost, ref: string, target: string): Pre;
  apply(h: OpHost, ref: string, target: string): Promise<{ status: number; op_id: string | null }>;
  compensate(h: OpHost, ref: string, target: string, pre: Pre): Promise<Compensation>;
}

const variantOf = (h: OpHost, id: string) => String((h.state(id) as { variant?: unknown } | null)?.variant ?? "");
const issuer = (h: OpHost, id: string) => (h.state(id) ?? {}) as { creds?: Record<string, { active: boolean }>; grants?: Record<string, string[]> };
const findGrant = (h: OpHost, id: string, ref: string) => {
  for (const [subject, grants] of Object.entries(issuer(h, id).grants ?? {})) for (const g of grants) if (grantRef(subject, g) === ref) return { subject, grant: g };
  return null;
};
const depot = (h: OpHost, id: string) => (h.state(id) ?? {}) as { artifacts?: Record<string, unknown>; deployed?: string | null };
const NOT_RESTORED = (what: string) => `${what}; restoring it as rollback would restore the compromised authority. A replacement needs a new reviewed plan and lease.`;

export const REPAIR_OPERATIONS: Record<RepairActionType, TypedOperation> = {
  set_gateway_policy: {
    resolve: (h, ref, t) => {
      const st = h.state(t);
      if (!st || !("variant" in st)) return `${t} has no policy variant`;
      if (/^policy:(baseline|candidate)$/.test(ref)) return null;
      return h.distractorVariants?.() === true && BENCH_DISTRACTOR_POLICY_REF.test(ref) ? null : `${ref} is not a reviewed policy`;
    },
    desired: (h, ref, t) => variantOf(h, t) === ref.slice("policy:".length),
    capture: (h, _ref, t) => ({ variant: variantOf(h, t) }),
    async apply(h, ref, t) { h.reconfigure(t, ref.slice("policy:".length) as "baseline" | "candidate" | "bench_overbroad" | "bench_residual" | "bench_misbound"); return { status: 200, op_id: null }; },
    async compensate(h, _ref, t, pre) {
      const prev = pre.variant;
      if (prev !== "baseline" && prev !== "candidate") return { outcome: "not_restored", reason: NOT_RESTORED(`the previous policy of ${t} was ${prev ?? "unknown"}, not a reviewed variant`) };
      if (variantOf(h, t) === prev) return { outcome: "not_needed", reason: `${t} is already on ${prev}` };
      h.reconfigure(t, prev);
      return { outcome: "restored_previous", reason: `${t} returned to the reviewed ${prev} policy` };
    },
  },
  deactivate_test_token: {
    resolve: (h, ref, t) => issuer(h, t).creds?.[ref] ? null : `${ref} is not a credential issued by ${t} in this run`,
    desired: (h, ref, t) => issuer(h, t).creds?.[ref]?.active === false,
    capture: (h, ref, t) => ({ active: String(issuer(h, t).creds?.[ref]?.active ?? null) }),
    async apply(h, ref, t) { const r = await h.send(t, `/credentials/${ref}/revoke`, {}); return { status: r.status, op_id: r.op_id }; },
    async compensate(_h, ref) { return { outcome: "not_restored", reason: NOT_RESTORED(`test token ${ref} stays deactivated`) }; },
  },
  remove_test_grant: {
    resolve: (h, ref, t) => findGrant(h, t, ref) ? null : `${ref} names no grant held in ${t}`,
    desired: (h, ref, t) => findGrant(h, t, ref) === null,
    capture: (h, ref, t) => { const g = findGrant(h, t, ref); return { subject: g?.subject ?? null, grant: g?.grant ?? null }; },
    async apply(h, ref, t) { const g = findGrant(h, t, ref)!; const r = await h.send(t, "/grants", { subject: g.subject, grant: g.grant, op: "remove" }); return { status: r.status, op_id: r.op_id }; },
    async compensate(_h, ref) { return { outcome: "not_restored", reason: NOT_RESTORED(`grant ${ref} stays removed`) }; },
  },
  select_test_artifact: {
    resolve: (h, ref, t) => depot(h, t).artifacts?.[ref] ? null : `artifact ${ref.slice(0, 16)} does not exist in ${t}`,
    desired: (h, ref, t) => depot(h, t).deployed === ref,
    capture: (h, _ref, t) => ({ deployed: depot(h, t).deployed ?? null }),
    async apply(h, ref, t) { const r = await h.send(t, "/deployed", { digest: ref }); return { status: r.status, op_id: r.op_id }; },
    async compensate(_h, _ref, t, pre) { return { outcome: "not_restored", reason: NOT_RESTORED(`the previously deployed artifact ${String(pre.deployed ?? "none").slice(0, 16)} of ${t} is not re-selected`) }; },
  },
  restart_test_observer: {
    resolve: (h, ref, t) => ref === t && h.observerUp(t) !== undefined ? null : `${ref} is not an observer of this run`,
    desired: (h, _ref, t) => h.observerUp(t) === true,
    capture: (h, _ref, t) => ({ up: String(h.observerUp(t)) }),
    async apply(h, _ref, t) { h.restartObserver(t); return { status: 200, op_id: null }; },
    async compensate() { return { outcome: "not_needed", reason: "stopping an observer is never a compensation" }; },
  },
};
export const refOf = (a: RepairAction) => a.parameters[REPAIR_ACTION_PARAMETER[a.type]]!;
