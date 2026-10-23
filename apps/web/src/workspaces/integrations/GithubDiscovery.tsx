import { useContext, useState } from "react";
import { ActionsCtx, type GithubPreview } from "../../inspector/actions.tsx";

/** R02.3: preview, then explicitly apply, read-only repository metadata. Workflow files are read as data only. */
export function GithubDiscoveryPanel() {
  const actions = useContext(ActionsCtx);
  const [owner, setOwner] = useState(""), [repo, setRepo] = useState(""), [preview, setPreview] = useState<GithubPreview | null>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  if (!actions || actions.role !== "admin") return null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(""); try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  return <article className="section-card" aria-label="Repository discovery" data-testid="github-discovery">
    <h3>Repository discovery (read-only)</h3>
    <p className="small">Reads repository, workflow, deployment and release metadata from the GitHub API. Nothing is cloned or executed, and nothing changes until you apply the preview.</p>
    <form onSubmit={(e) => { e.preventDefault(); void run(async () => setPreview(await actions.githubPreview(owner, repo))); }} className="filter-bar">
      <label className="field">Owner<input aria-label="GitHub owner" value={owner} maxLength={100} onChange={(e) => setOwner(e.target.value)} required /></label>
      <label className="field">Repository<input aria-label="GitHub repository" value={repo} maxLength={100} onChange={(e) => setRepo(e.target.value)} required /></label>
      <button className="btn" disabled={busy}>Preview</button>
    </form>
    {msg && <p className="scope-note warning" role="alert">{msg}</p>}
    {preview && <div aria-live="polite">
      <p className="small"><strong>{preview.repository}</strong>: {preview.additions.length} to add, {preview.removals.length} to remove, {preview.changes.length} changed{preview.collisions.length ? `, ${preview.collisions.length} id collisions skipped` : ""}.</p>
      {preview.partial.length > 0 && <ul className="small">{preview.partial.map((p, i) => <li key={i}>Partial: {p.resource}: {p.reason}</li>)}</ul>}
      <button className="btn" disabled={busy} onClick={() => void run(async () => { await actions.githubApply(preview.preview_id, preview.base_graph_revision); setMsg("Applied to the inventory."); setPreview(null); })}>Apply preview</button>
    </div>}
  </article>;
}
