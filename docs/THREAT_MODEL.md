# Threat model (v0.3)

## Assets worth protecting
Redacted event evidence; asset inventory and topology; findings, notes and dispositions; source keys and user tokens (stored as SHA-256 hashes); the export-signing secret; the audit log.

## Trust boundaries
| Boundary | Untrusted side | Control |
|---|---|---|
| Ingestion (`/ingest/*`, `/v1/traces`) | Sources and anything they relay from the internet | Source key → one project; payload `project_id` must match or is rejected; schema; size, depth, node and batch limits; no compressed bodies; proto-pollution rejection; redaction before storage |
| Browser ↔ API | Users and other origins | Token or HttpOnly SameSite=Strict session; `X-DK-Request` header on cookie writes; server-side role checks; strict CSP; `nosniff`; frame denial |
| AI planner | Model output | Sanitized input (ids, kinds, names only); output parsed, schema- and semantics-validated, compiled by trusted code; bounded retries; deterministic fallback |
| MCP agents | Agents and text they've read | Role-scoped tokens; evidence returned as explicitly untrusted data; no tool can change monitored systems; containment proposals need a different human |
| Repo importers | Compose files and manifests | Allowlisted keys only; no code execution; no environment values; alias-bomb limits; size caps |

## Abuse cases and responses
- **Forged request id from the public** → marked `untrusted` unless the source is boundary-local and configured to trust ids; untrusted ids are never used for cross-source linking (tested E04).
- **Source writes into another project** → rejected and counted (S03).
- **Hostile labels (`<script>`, prompt injection in names)** → React text rendering, no `dangerouslySetInnerHTML`; planner strips markup; MCP marks evidence untrusted (S04, S09).
- **Decompression / nesting / huge batch DoS** → 415 / 413 responses (S07).
- **Secrets in payloads** → keys like authorization, cookie, password, token, api_key removed; bearer tokens, JWTs, common key prefixes and card-like numbers masked (S08).
- **AI proposes invented assets or "compromised" flags** → rejected; unknown fields are forbidden by schema (S10).
- **Tampered case export** → digest or HMAC mismatch reported by `/api/verify-export` (S12).
- **Synthetic data shown as live** → separate dataset kinds enforced at graph, source and ingest; persistent SYNTHETIC DEMO badge (S14).
- **Self-approved containment** → the requesting token cannot decide; service tokens cannot decide; viewers cannot request. Residual risk: one person holding two human tokens. Bind tokens to an IdP before introducing any executor.
- **Compromised or misconfigured producer** → can only assert events about its assigned assets and permitted categories; observation categories need explicit grants; relays share an independence group, so they cannot fabricate corroboration.
- **Secrets at rest** → redacted before the journal write; secure_delete on; free text with no recognizable pattern remains a residual risk.
- **Agent acts on partial evidence** → evidence bundles report expected and returned counts, missing references and truncation; unresolved targets yield not_assessed or insufficient_context.

## Out of scope (v0.2)
Host compromise of the Digital Kingdom server itself, HA and failover, multi-tenant isolation beyond projects, legal-grade evidence custody.
