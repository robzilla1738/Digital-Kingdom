import { useContext, useEffect, useState } from "react";
import { ActionsCtx, type ConnectorCatalogResult } from "../../inspector/actions.tsx";

const LEVEL_LABEL: Record<string, string> = { declared: "Declared", discovered: "Discovered", instrumented: "Instrumented", analyzed: "Analyzed", lab_verified: "Lab verified", live_verified: "Live verified" };

/**
 * R02.1: connectors as inspectable manifests. Only the protocol versions a manifest lists are shown as supported;
 * each capability shows how far it has actually been verified. Connectors collect; none can respond.
 */
export function ConnectorCatalog() {
  const actions = useContext(ActionsCtx);
  const [data, setData] = useState<ConnectorCatalogResult | null>(null), [error, setError] = useState("");
  useEffect(() => { if (!actions) return; const c = new AbortController(); actions.connectors(c.signal).then(setData, (e: Error) => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [actions]);
  if (!actions) return <div className="empty"><h3>Connector manifests come from the server.</h3><p>The offline demo has no server; see the documentation for the supported release.</p></div>;
  if (error) return <p className="scope-note warning" role="alert">Connector catalog unavailable: {error}</p>;
  if (!data) return <p className="small faint">Loading connector manifests…</p>;
  return <div className="integration-grid" data-testid="connector-catalog">
    <p className="scope-note">{data.note}</p>
    {data.connectors.map((c) => <article key={c.id} className="section-card" aria-label={`Connector ${c.name}`}>
      <h3>{c.name}</h3>
      <p className="small">Supported: <strong>{c.protocol.name}</strong> {c.protocol.versions.join(", ")} · {c.protocol.encodings.join(", ")}. Other versions and encodings are not supported.</p>
      <p className="small">Authority: collect only. Scopes: {c.read_scopes.map((s) => `${s.scope} (${s.why})`).join("; ")}</p>
      <table className="data-table"><thead><tr><th>Capability</th><th>Verification</th><th>Evidence</th></tr></thead><tbody>
        {c.capabilities.map((cap) => <tr key={cap.capability}><td>{cap.capability}</td><td><span className={`chip level-${cap.level}`}>{LEVEL_LABEL[cap.level] ?? cap.level}</span></td><td className="small">{cap.evidence}</td></tr>)}
      </tbody></table>
      <ul className="small faint">{c.limits.map((l) => <li key={l}>{l}</li>)}</ul>
    </article>)}
  </div>;
}
