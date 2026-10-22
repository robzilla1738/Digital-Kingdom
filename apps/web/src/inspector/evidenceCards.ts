import type { SecurityEvent } from "@dk/contracts";

export const EVIDENCE_CARDS_PER_PAGE = 20;
export const EVIDENCE_TEXT_LIMIT = 4096;

/** Display pagination only. The caller retains the complete, ordered loaded collection. */
export function evidenceDisplayPage<T>(records: readonly T[], requestedPage: number, pageSize = EVIDENCE_CARDS_PER_PAGE) {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : EVIDENCE_CARDS_PER_PAGE;
  const pages = Math.max(1, Math.ceil(records.length / size));
  const page = Math.min(pages, Math.max(1, Math.floor(requestedPage) || 1));
  const start = (page - 1) * size, end = Math.min(records.length, start + size);
  return { page, pages, start, end, total: records.length, items: records.slice(start, end) };
}

/** Keep surrogate pairs intact at page boundaries without exceeding the visible text limit. */
export function evidenceTextPage(text: string, requestedPage: number, limit = EVIDENCE_TEXT_LIMIT) {
  const stride = Math.max(2, Math.floor(limit) - 1), pages = Math.max(1, Math.ceil(text.length / stride));
  const page = Math.min(pages, Math.max(1, Math.floor(requestedPage) || 1));
  const boundary = (offset: number) => offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/.test(text[offset]!) && /[\uD800-\uDBFF]/.test(text[offset - 1]!) ? offset - 1 : offset;
  const start = boundary((page - 1) * stride), end = boundary(Math.min(text.length, page * stride));
  return { page, pages, start, end, total: text.length, text: text.slice(start, end) };
}

/** Only this exact event's referenced records are included, not the rest of the finding bundle. */
export function evidenceCardPayload(event: SecurityEvent, evidence: Record<string, Record<string, unknown>>) {
  const stored = [...new Set(event.evidence_refs.filter((ref) => ref.startsWith("evidence:")))];
  return {
    normalized_event: event,
    redacted_stored_evidence: Object.fromEntries(stored.filter((ref) => evidence[ref]).map((ref) => [ref, evidence[ref]])),
    missing_stored_evidence_refs: stored.filter((ref) => !evidence[ref]),
    source_native_references_not_stored_payloads: event.evidence_refs.filter((ref) => !ref.startsWith("evidence:")),
  };
}
