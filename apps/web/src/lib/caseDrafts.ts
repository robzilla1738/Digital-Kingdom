/**
 * LP12 unsaved case drafts, kept in memory and scoped to (project, case, field).
 *
 * Switching cases must never carry a draft into the wrong case, and switching back must restore it. Drafts are not
 * written to localStorage/sessionStorage (they can contain investigation text) and are cleared with every other piece
 * of sensitive client state on sign-out, project change or authorization change.
 */
export type DraftScope = { project: string; caseId: string };
const SEP = "\u0000";
export class CaseDrafts {
  private readonly values = new Map<string, string>();
  private key(scope: DraftScope, field: string) { return [scope.project, scope.caseId, field].join(SEP); }
  get(scope: DraftScope, field: string): string { return this.values.get(this.key(scope, field)) ?? ""; }
  set(scope: DraftScope, field: string, value: string) { if (value) this.values.set(this.key(scope, field), value); else this.values.delete(this.key(scope, field)); }
  clear(scope: DraftScope, field: string) { this.values.delete(this.key(scope, field)); }
  /** Fields with an unsaved value in this scope (shown so a person sees what is pending). */
  pending(scope: DraftScope): string[] { const p = [scope.project, scope.caseId, ""].join(SEP); return [...this.values.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length)).sort(); }
  clearProject(project: string) { for (const k of [...this.values.keys()]) if (k.startsWith(project + SEP)) this.values.delete(k); }
  clearAll() { this.values.clear(); }
  get size() { return this.values.size; }
}
/** The console's single draft store. */
export const caseDrafts = new CaseDrafts();
