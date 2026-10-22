import { useContext, useEffect, useRef, useState } from "react";
import { EVENT_ACTIONS, EVENT_OUTCOMES, type EventSearchResponse, type SecurityEvent } from "@dk/contracts";
import { useApp } from "../../lib/state.tsx";
import { ACTION_LABEL, COVERAGE_STYLE, fmtDateTime } from "../../lib/vocab.ts";
import { EVENT_FILTERS, filterGuidance, isAccessDenied, MAX_EVENT_INTERVAL_MS, mergeEventPages, searchOfflineEvents, validateEventQuery, type EventFilterField, type EventSearchInput } from "../../lib/investigation.ts";
import { ActionsCtx } from "../../inspector/actions.tsx";
import { PrivacyAction } from "../../inspector/Shared.tsx";
import { evidenceDisplayPage } from "../../inspector/evidenceCards.ts";

const EVENT_ROWS_PER_DISPLAY_PAGE = 100;

type FilterRow = { field: EventFilterField; value: string };
function inputTime(iso: string, zone: string) { const date = new Date(iso); return zone === "utc" ? date.toISOString().slice(0, 19) : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19); }
function normalizedTime(value: string, zone: string): string { if (!value) return ""; const date = new Date(zone === "utc" ? `${value}Z` : value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }

export function EventWorkspace() {
  const { ui, vm, dispatch } = useApp();
  const actions = useContext(ActionsCtx), actionsRef = useRef(actions); actionsRef.current = actions;
  const initialEnd = vm.data.window.end, initialStart = new Date(Math.max(Date.parse(vm.data.window.start), Date.parse(initialEnd) - MAX_EVENT_INTERVAL_MS)).toISOString();
  const [zone, setZone] = useState("utc"), [after, setAfter] = useState(inputTime(initialStart, "utc")), [before, setBefore] = useState(inputTime(initialEnd, "utc"));
  const [filters, setFilters] = useState<FilterRow[]>(ui.eventAssetFilter ? [{ field: "asset_id", value: ui.eventAssetFilter }] : []);
  const [rows, setRows] = useState<SecurityEvent[]>([]), [result, setResult] = useState<EventSearchResponse | null>(null);
  const [submitted, setSubmitted] = useState<EventSearchInput | null>(null), [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]);
  const [denied, setDenied] = useState(false), [changed, setChanged] = useState(false), [announcement, setAnnouncement] = useState("");
  const [displayPage, setDisplayPage] = useState(1);
  const display = evidenceDisplayPage(rows, displayPage, EVENT_ROWS_PER_DISPLAY_PAGE);
  const [pageCount, setPageCount] = useState(0), [baselineCursor, setBaselineCursor] = useState<number | null>(null);
  const request = useRef(0), controller = useRef<AbortController | null>(null), offlineSnapshot = useRef(vm.data);
  const clearQuery = () => { controller.current?.abort(); ++request.current; setRows([]); setResult(null); setSubmitted(null); setBusy(false); setErrors([]); setDenied(false); setPageCount(0); setDisplayPage(1); setBaselineCursor(null); setChanged(true); };
  useEffect(() => () => { controller.current?.abort(); ++request.current; }, []);
  useEffect(() => { if (ui.eventAssetFilter) { clearQuery(); setFilters((previous) => [{ field: "asset_id", value: ui.eventAssetFilter! }, ...previous.filter((row) => row.field !== "asset_id")]); } }, [ui.eventAssetFilter]);
  const readQuery = (): EventSearchInput => ({ after: normalizedTime(after, zone), before: normalizedTime(before, zone), filters: Object.fromEntries(filters.filter((row) => row.value !== "").map((row) => [row.field, row.value])), limit: 50 });
  const search = async (next = false) => {
    if (busy) return;
    const query = next && submitted ? { ...submitted, ...(result?.page.next_cursor ? { cursor: result.page.next_cursor } : {}) } : readQuery();
    const invalid = validateEventQuery(query); if (invalid.length) { setErrors(invalid); return; }
    if (vm.data.mode === "server" && !actionsRef.current) { setErrors(["Event search is not available in this deployment."]); return; }
    controller.current?.abort(); controller.current = new AbortController(); const signal = controller.current.signal, seq = ++request.current;
    setBusy(true); setErrors([]); setDenied(false); setChanged(false);
    if (!next) { setRows([]); setResult(null); setPageCount(0); setDisplayPage(1); setSubmitted(query); setBaselineCursor(vm.latestData.cursor); offlineSnapshot.current = vm.data; }
    try {
      const response = vm.data.mode === "offline-demo" ? searchOfflineEvents(offlineSnapshot.current, query, next ? rows.length : 0) : await actionsRef.current!.searchEvents(query, signal);
      if (seq !== request.current || signal.aborted) return;
      if (response.project_id !== vm.data.project.id) throw new Error("Search response did not match the requested project.");
      if (next && result && response.snapshot_seq !== result.snapshot_seq) throw new Error("The server returned a different snapshot. Start a new search; existing rows remain pinned.");
      const combined = next ? mergeEventPages(rows, response.events) : response.events;
      setRows(combined); setResult(response); setPageCount((count) => next ? count + 1 : 1);
      setAnnouncement(`${combined.length} of ${response.query_completeness.matching_in_snapshot} stored matches loaded. ${response.query_completeness.complete ? "Stored snapshot complete." : "More stored matches remain."}`);
    } catch (error) {
      if (seq !== request.current || signal.aborted) return;
      if (isAccessDenied(error)) { setRows([]); setResult(null); setSubmitted(null); setFilters([]); setAfter(""); setBefore(""); setDenied(true); setBaselineCursor(null); setPageCount(0); setDisplayPage(1); setErrors(["Access denied. Sensitive search records, filters and cursors have been removed."]); }
      else setErrors([`Could not load ${next ? "the next page" : "events"}: ${(error as Error).message}${next ? ". Previously loaded records are retained; results are incomplete." : ". No synthetic data was substituted."}`]);
    } finally { if (seq === request.current && !signal.aborted) setBusy(false); }
  };
  const setQuick = (duration: number) => { clearQuery(); const end = vm.data.mode === "offline-demo" ? vm.data.window.end : vm.latestData.window.end; setAfter(inputTime(new Date(Date.parse(end) - duration).toISOString(), zone)); setBefore(inputTime(end, zone)); };
  const name = (id: string) => vm.data.graph.assets.find((asset) => asset.id === id)?.name ?? id;
  const newer = !!result && baselineCursor !== null && vm.latestData.cursor > baselineCursor;
  const later = result?.query_completeness.later_arrivals_not_included ?? 0;
  const scopeText = submitted && result ? [`Project: ${vm.data.project.id}`, `Query interval: ${submitted.after} to ${submitted.before}`, `Snapshot: ${result.snapshot_seq}`, `Loaded: ${rows.length}/${result.query_completeness.matching_in_snapshot}; ${result.query_completeness.complete && !errors.length ? "complete for stored snapshot" : "incomplete"}`, `Current source coverage as of ${result.source_coverage.coverage_as_of}; historical coverage not assessed.`, `Exact filter fields used: ${Object.keys(submitted.filters).join(", ") || "none"}. Values excluded.`, "Raw event content, credentials, actor/session/network values and signed pagination cursors excluded.", "Not evidence of absence outside reporting sources."].join("\n") : "";
  return <section className="workspace-page event-workspace" aria-label="Event investigation" data-testid="event-workspace">
    <div className="workspace-heading"><h1>Search recorded events</h1><p className="workspace-lede">Find stored events independently of findings. A search result does not create a finding.</p></div>
    {vm.data.mode === "offline-demo" && <p className="scope-note warning">Synthetic demo — only the bundled in-memory dataset is searched. No production systems or server archive are connected.</p>}
    <form className="section-card event-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <div className="filter-bar"><label className="field">Start time<input aria-label="Event start time" type="datetime-local" step="1" value={after} onChange={(event) => { clearQuery(); setAfter(event.target.value); }} required /></label><label className="field">End time<input aria-label="Event end time" type="datetime-local" step="1" value={before} onChange={(event) => { clearQuery(); setBefore(event.target.value); }} required /></label><label className="field">Timezone<select value={zone} onChange={(event) => { const a = normalizedTime(after, zone), b = normalizedTime(before, zone); clearQuery(); setZone(event.target.value); if (a) setAfter(inputTime(a, event.target.value)); if (b) setBefore(inputTime(b, event.target.value)); }}><option value="utc">UTC</option><option value="local">Browser local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option></select></label></div>
      <div className="inline-actions" aria-label="Quick event intervals">{[["15 minutes", 15 * 60_000], ["1 hour", 3_600_000], ["24 hours", 86_400_000], ["7 days", 7 * 86_400_000]].map(([label, duration]) => <button className="btn sm" type="button" key={label} onClick={() => setQuick(Number(duration))}>{label}</button>)}</div>
      <p className="small faint">Custom start/end supported. Maximum 31 days, enforced by both client validation and server authorization. Search submits deliberately; typing sends no queries.</p>
      <fieldset><legend>Exact-match filters</legend>{filters.map((row, index) => <div key={index} className="event-filter-row">
        <label className="field">Field<select aria-label={`Filter ${index + 1} field`} value={row.field} onChange={(event) => { clearQuery(); setFilters((previous) => previous.map((item, i) => i === index ? { field: event.target.value as EventFilterField, value: "" } : item)); }}>{Object.entries(EVENT_FILTERS).filter(([key]) => key === row.field || !filters.some((filter) => filter.field === key)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <span className="filter-operator">equals</span><label className="field">Value{row.field === "action" || row.field === "outcome" ? <select aria-label={`Filter ${index + 1} value`} value={row.value} onChange={(event) => { clearQuery(); setFilters((previous) => previous.map((item, i) => i === index ? { ...item, value: event.target.value } : item)); }}><option value="">Choose a value</option>{(row.field === "action" ? EVENT_ACTIONS : EVENT_OUTCOMES).map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input aria-label={`Filter ${index + 1} value`} maxLength={200} value={row.value} list={row.field === "asset_id" ? "event-search-assets" : row.field === "source_id" ? "event-search-sources" : undefined} onChange={(event) => { clearQuery(); setFilters((previous) => previous.map((item, i) => i === index ? { ...item, value: event.target.value } : item)); }} />}</label>
        <button className="btn sm" type="button" aria-label={`Remove filter ${index + 1}`} onClick={() => { clearQuery(); setFilters((previous) => previous.filter((_, i) => i !== index)); }}>Remove</button>{filterGuidance(row.field) && <p className="scope-note">{filterGuidance(row.field)}</p>}
      </div>)}<button className="btn sm" type="button" disabled={filters.length >= Object.keys(EVENT_FILTERS).length} onClick={() => { clearQuery(); const field = (Object.keys(EVENT_FILTERS) as EventFilterField[]).find((value) => !filters.some((row) => row.field === value)); if (field) setFilters((previous) => [...previous, { field, value: "" }]); }}>Add exact filter</button></fieldset>
      <datalist id="event-search-assets">{vm.data.graph.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</datalist><datalist id="event-search-sources">{vm.data.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</datalist>
      <div className="btn-row"><button className="btn primary" disabled={busy}>{busy ? "Searching…" : "Search events"}</button><span className="small faint">Shared links exclude sensitive filter values by default.</span></div>
    </form>
    <p role="status" className="sr-only">{announcement}</p>
    {changed && !result && <p className="scope-note">Query changed. Pages and cursor were cleared; submit a new search.</p>}
    {errors.length > 0 && <div className="scope-note warning" role="alert" data-testid="event-search-error"><ul className="bullets">{errors.map((error) => <li key={error}>{error}</li>)}</ul>{result && !denied && <button className="btn sm" disabled={busy} onClick={() => void search(true)}>Retry next page</button>}</div>}
    {busy && !result && <div className="section-card" role="status" aria-busy="true">Loading the exact submitted interval and filters…</div>}
    {result && submitted && <>
      <section className="section-card" aria-label="Pinned search scope"><h2>{result.query_completeness.matching_in_snapshot} stored matches in snapshot {result.snapshot_seq}</h2><p data-testid="event-query-completeness">{rows.length} loaded across {pageCount} {pageCount === 1 ? "page" : "pages"}. {result.query_completeness.complete && !errors.length ? "All stored matches in this snapshot loaded." : "Results are incomplete. Continue before drawing conclusions from absence."}</p><p className="small">UTC interval: {fmtDateTime(submitted.after)} → {fmtDateTime(submitted.before)}</p><p className="small faint">Exact filters: {Object.entries(submitted.filters).map(([field, value]) => `${EVENT_FILTERS[field as EventFilterField]} equals ${value}`).join("; ") || "None"}</p>
        {(later > 0 || newer) && <p className="scope-note warning" data-testid="new-event-records">{later > 0 ? `${later} newer matching records are outside this snapshot.` : "New project records are available; matching records may exist outside this snapshot."} Start a new search to include them. Existing pages remain unchanged.</p>}
        <PrivacyAction label="Copy search context" title="Search context privacy preview" text={scopeText} scope={[`Project ${vm.data.project.id}; pinned snapshot ${result.snapshot_seq}; ${rows.length} loaded records.`, "Includes interval, filter field names, completeness and coverage limitations. All filter values, raw evidence, credentials and signed cursors are excluded."]} />
      </section>
      <section className="section-card" aria-label="Search source coverage" data-testid="event-source-coverage"><h2>Source coverage is separate</h2><p>Current coverage as of {fmtDateTime(result.source_coverage.coverage_as_of)}. Historical coverage during this interval has not been assessed.</p><p className="small faint">Stored match counts do not establish complete visibility. Current source health is not pinned to the event snapshot.</p>{result.source_coverage.sources.length === 0 && <p className="scope-note warning">No configured sources in this query scope. Activity outside reporting sources may be missing.</p>}
        <ul className="mini-list">{result.source_coverage.sources.map((source) => <li key={source.source_id}><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "source", id: source.source_id } })}><span className="grow">{source.label}</span><span>{source.disabled ? "Administratively disabled" : COVERAGE_STYLE[source.current_state].label}</span></button></li>)}</ul>
        {result.source_coverage.gaps.length > 0 && <details><summary>Visibility limitations ({result.source_coverage.gaps.length})</summary><ul className="bullets">{result.source_coverage.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
      </section>
      {rows.length > 0 && <section className="section-card" aria-label="Loaded event display pages" data-testid="event-display-pagination">
        <p role="status">Showing {display.start + 1}–{display.end} of {rows.length} loaded records. Display page {display.page} of {display.pages}; at most {EVENT_ROWS_PER_DISPLAY_PAGE} rows are rendered at once.</p>
        <p className="small faint">All loaded pages remain in memory. Display paging does not fetch records, change the pinned server snapshot or advance its cursor. Use Load next page to retrieve more stored matches.</p>
        {display.pages > 1 && <nav className="btn-row" aria-label="Loaded event display navigation">
          <button className="btn sm" disabled={display.page === 1} onClick={() => setDisplayPage(1)}>First event display page</button>
          <button className="btn sm" disabled={display.page === 1} onClick={() => setDisplayPage(display.page - 1)}>Previous event display page</button>
          <button className="btn sm" disabled={display.page === display.pages} onClick={() => setDisplayPage(display.page + 1)}>Next event display page</button>
          <button className="btn sm" disabled={display.page === display.pages} onClick={() => setDisplayPage(display.pages)}>Last event display page</button>
        </nav>}
      </section>}
      {rows.length ? <div className="table-scroll"><table className="record-table" aria-label="Stored event results"><thead><tr><th scope="col">Occurred / received (UTC)</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Asset</th><th scope="col">Source</th><th scope="col">Evidence availability</th></tr></thead><tbody>{display.items.map((event) => <tr key={event.id} data-event-result-id={event.id} aria-selected={ui.selection?.kind === "event" && ui.selection.id === event.id}>
        <td>{fmtDateTime(event.occurred_at)}<small>Received {fmtDateTime(event.received_at)}</small></td><td><button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "event", id: event.id } })} aria-label={`Open event ${event.id}`}>{ACTION_LABEL[event.action] ?? event.action}</button><small>{event.id}</small></td><td>{event.outcome === "success" ? "Operation succeeded" : event.outcome === "observed" ? "Effect observed" : event.outcome}</td><td>{event.asset_ids.map(name).join(", ") || "No asset mapping"}</td><td>{event.source_id}</td><td>{event.evidence_refs.some((ref) => ref.startsWith("evidence:")) ? "Not loaded; open to check" : "Normalized event only"}</td>
      </tr>)}</tbody></table></div> : <p className="scope-note" data-testid="event-search-empty">No stored events match this query. Activity outside reporting sources may be missing.</p>}
      {result.page.has_more && <button className="btn" disabled={busy} onClick={() => void search(true)}>{busy ? "Loading next page…" : "Load next page"}</button>}
      {result.correlation.map((note, i) => <p className="scope-note" key={i}>{note.namespace}: {note.trust}</p>)}
    </>}
    {!result && !busy && !changed && !errors.length && <p className="scope-note">Choose an interval and optional exact filters, then search. No event query has been submitted.</p>}
  </section>;
}
