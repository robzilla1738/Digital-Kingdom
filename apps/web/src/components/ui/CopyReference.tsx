import { useState } from "react";
export function CopyReference({ value, label = "Copy reference" }: { value: string; label?: string }) {
  const [status, setStatus] = useState("");
  return <div className="copy-reference"><button type="button" className="btn" onClick={async () => { try { if (!navigator.clipboard) throw new Error("unavailable"); await navigator.clipboard.writeText(value); setStatus("Copied"); } catch { setStatus("Copy unavailable. Select and copy the text below."); } }}>{status === "Copied" ? "Copied" : label}</button><span className="sr-only" role="status">{status}</span>{status.startsWith("Copy unavailable") && <div className="scope-note"><p>{status}</p><pre tabIndex={0}>{value}</pre></div>}</div>;
}
