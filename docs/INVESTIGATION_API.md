# Investigation API: event search, change assessment v2, validation errors

Status: on branch `improve/investigation-honesty` and not merged. Everything here is read-only for the caller, and all of it is enforced server-side for the project the caller is authorized for.

## 1. Event-level investigation

| HTTP | MCP tool | Role | Contract |
|---|---|---|---|
| `GET /api/projects/:p/events/search` | `dk_search_events` | viewer | `packages/contracts/schemas/agent/event-search.v1.schema.json` |
| `GET /api/projects/:p/events/:id` | `dk_get_event` | viewer | `packages/contracts/schemas/agent/event-detail.v1.schema.json` |

Both tools are in the read-only MCP profile (`DK_MCP_TOOLS=investigation`). The v1 evaluation profile, which has no event search, stays reproducible as `DK_MCP_TOOLS=investigation-v1`.

### What can be searched

Normalized, redacted events, whether or not any finding references them. Payloads and secrets were removed at ingestion and can't be retrieved.

- **Required:** `after` and `before`, as ISO 8601 with an offset. The interval can be at most **31 days**, and `before` must be later than `after`.
- **Exact-match filters:** `actor_ref`, `session_ref`, `run_id`, `request_id`, `trace_id`, `client_ip`, `route`, `rule_ref`, `source_id`, `asset_id`.
- **Allowlisted values only:** `action` and `outcome`, each a comma list of up to 10.
- **Page size:** `limit` from 1 to 100 (default 50).
- **Paging:** `cursor` from the previous page of the same search.
- **No free-form language:** there's no SQL, no expressions, and no backend paths. An unknown parameter is a 422.

### Pagination

- Results are ordered by `(occurred_at, id)` and paged by keyset.
- The first page pins the project's event high-water mark (`snapshot_seq`), and every later page reads that same snapshot. An event that arrives mid-pagination, even one with an earlier timestamp, can't shift pages, duplicate a record, or fill a gap silently. It's counted in `query_completeness.later_arrivals_not_included` instead.
- A cursor is HMAC-signed and bound to the project, the interval and the filters. The page size can change between pages. A cursor reused on another project, with other filters, or after tampering is rejected with a 400.
- Authorization is checked again on every page, so a token that loses access can't keep paging.

### Three completeness notions, never conflated

| Field | Question it answers |
|---|---|
| `query_completeness` | Did these pages return every **stored** event matching the filters in the pinned snapshot? `complete`, `truncated`, `matching_in_snapshot`, `later_arrivals_not_included` |
| `source_coverage` | Could the sources that would record this activity have recorded it? Per-source `current_state`, `events_in_interval`, `disabled`; `unobserved_asset_ids`; plain-language `gaps` |
| finding-bundle completeness | Is a finding's own evidence bundle complete? Reported by `GET /findings/:id/evidence` / `dk_get_finding`, not here |

An empty, complete result means only that no stored event matched. It never means the activity did not occur. `limits` repeats that in every response.

Event detail reports `evidence_completeness`: expected, returned and `missing_evidence_refs`, plus a note when an event never had a stored evidence record. It also lists `referenced_by_findings`, which may be empty.

### Correlation namespaces and trust limits

| Field | Namespace | Trust limit |
|---|---|---|
| `actor_ref` | per source | An account id as one source reports it. The same string from two sources is a lead, not proof of one principal (no source declares a shared identity namespace). |
| `session_ref`, `run_id`, `rule_ref` | per source | Meaningful only within the source that issued it. |
| `request_id` | per source unless trusted | Correlates across sources only when the event says `request_id_trust: trusted`. Otherwise it is client-supplied. |
| `trace_id` | per instrumentation | Can be absent or client-influenced at the edge. |
| `client_ip` | **network locator, not identity** | Shared egress, NAT, VPN, proxies and CGNAT put unrelated people behind one address. Digital Kingdom never attributes events to a common actor because they share an address, and agents must not either. |
| `route` | normalized path | Identifiers removed; many callers share one route. |
| `source_id`, `asset_id` | project | Source authenticated by its key; assets as that source is configured to report them. |

Each response carries the notes for the filters used, plus `client_ip` whenever returned events contain addresses.

## 2. Change assessment v2 (`dk.change_assessment.v2`)

`POST /api/projects/:p/assess-change` / `dk_assess_change`. Contract: `schemas/agent/change-assessment.v2.schema.json`.

- `target_resolution` (did every target resolve) and `evidence_sufficiency` (is the telemetry needed to assess each resolved target reporting) are separate.
- A resolved target is evidence-insufficient when no source covers it (`unobserved`), or when any covering source is `stale` (degraded), `offline`, or not assessed.
- Only sources covering the targets count. A stale source elsewhere in the project doesn't block an unrelated target.
- Posture order:
  1. Nothing resolved: `not_assessed`.
  2. A severe finding: `hold`, with gaps still listed in `evidence_sufficiency`.
  3. Any unresolved target or insufficient evidence: `insufficient_context`.
  4. Findings: `proceed_with_care`.
  5. Otherwise: `no_recorded_concerns`.
- `favorable` is true only for the last two, and the schema requires full resolution and sufficient evidence whenever it is true.
- **Breaking:** v1's `assessment_complete` was removed. It read `true` when a target's coverage was stale or offline. Consumers updated: the MCP tool description, server tests, and the README. The web app never read it.

## 3. Validation errors

- Invalid input returns the project's usual body, `{ "error": string, "details": string[] }`, at HTTP 422 (or 400 for request-shape problems such as a bad cursor). Contract: `schemas/agent/validation-error.schema.json`.
- Each detail starts with a JSON-pointer style path, for example `/assets/1/kind: unsupported asset kind "lambda"; allowed: edge, auth, ...`.
- A manifest is fully validated before anything is built: asset ids and kinds, relationship kinds and shapes, YAML syntax, and size and count limits. An invalid import leaves the graph and the scene unchanged. Compose structure and YAML errors get the same treatment.
- Unexpected internal errors stay HTTP 500 with `{ "error": "internal error" }` and no details.
