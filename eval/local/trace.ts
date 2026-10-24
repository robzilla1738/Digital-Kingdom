/** Shared trace helpers (no heavy imports: used by the native-agent proxy too). */
export const redact = (s: string, secrets: string[]) => secrets.reduce((a, x) => (x && x.length > 6 ? a.split(x).join("[redacted]") : a), s);

/** Denials: the protocol refused the call (unknown tool, schema), the server refused (4xx), or a ref was not found. */
export function classifyDenial(text: string, isError: boolean): string | null {
  if (/Tool .* not found|Unknown tool|tool not found/i.test(text)) return "unknown_tool";
  if (/MCP error -32602|Invalid arguments|invalid_type|too_big|too_small/i.test(text)) return "schema_refused";
  if (isError && /\b(401|403)\b|forbidden|unauthori[sz]ed|revoked/i.test(text)) return "authority_refused";
  if (isError && /\b404\b|not found/i.test(text)) return "not_found";
  if (isError) return "error";
  if (/"found"\s*:\s*false/.test(text)) return "ref_not_found";
  return null;
}

