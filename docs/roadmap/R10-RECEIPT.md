# R10 receipt

## R10.1 deployment identity and secret handling

Delivered: `apps/server/src/oidc.ts`, migration 12 (token `expires_at`, `rotated_to`, OIDC subject columns,
`oidc_subjects`), `POST /api/session/oidc`, `POST /api/oidc-subjects`, `POST /api/tokens/:id/rotate`, service-token
expiry, audited logout, trusted-proxy check, demo default, `scripts/recover-admin.ts`, SECURITY.md section.

Acceptance (`apps/server/test/identity-r10.test.ts`, 7 tests):
- Project scope survives rotation; the old secret and its sessions stop immediately; expiry ends access; SSO
  unmapping revokes a live session.
- No token/key/secret/session value is written to browser storage (source scan); sessions are HttpOnly cookies.
  Logs and trace artifacts: request logging is off by default and `safeDetail` masks token-shaped values (R00.4);
  not separately re-tested here.
- Forwarded `https` counts only from a listed proxy peer; existing CSRF/cookie tests still pass.
- Recovery needs filesystem access, yields a 24-hour human admin and is audited; it cannot mint service tokens.
- Found and fixed while testing: Fastify's `req.protocol` honours `X-Forwarded-Proto` from any peer when
  `trustProxy` is a list; the server now checks the socket peer itself.

External gate still open: live verification against a real identity provider (`identity_provider_for_live_verification`).
Field-level access control is not implemented beyond project and role scope.

## R10.2 measure ingestion resilience and recovery

Delivered: `Store.admit` (per-source rolling budget), `maxBacklog` backpressure, disk-full mapping, `apps/server/src/backup.ts`, `scripts/backup.ts`, `scripts/soak.ts`, `docs/OPERATIONS_RECOVERY.md`.

Acceptance (`apps/server/test/resilience-r10.test.ts`, 6 tests):
- Disk full (forced with `PRAGMA max_page_count`), a crash inside the processing transaction, duplicate replay and a re-keyed source leave the checkpoint consistent and integrity ok.
- Restore of an encrypted backup verifies integrity, foreign keys, finding-to-event references, checkpoint bounds and counts; wrong passphrase and a flipped byte fail closed; restore never overwrites.
- A noisy source is held to its budget while a quiet source is admitted and processed.
- No deletion was added; the journal is not pruned.

Soak (100,000 events, ARM64 2-core): 9,400 events/s durable ingest, 3,500 events/s processing, 0.7 s backup and 1.0 s verified restore of 133 MB.

Limitations: admission budgets are per process (in memory); single-node SQLite only (R10.3); no off-host backup shipping.

## R10.5 release identity and extension contracts

- Candidate: roadmap/batch4 (commit follows this receipt).
- Changed: packages/extension-sdk (new: src, test, examples/rate-limit-rule), scripts/pin-extension.ts, scripts/release-lib.ts, scripts/release-manifest.ts, scripts/dependency-inventory.ts, package.json scripts, .github/workflows/ci.yml, docs/RELEASE.md, docs/EXTENSIONS.md, docs/THIRD_PARTY_NOTICES.md (207 production packages, 0 outside the allow-list), docs/release/branch-ruleset.proposed.json, CONTRIBUTING.md, test/release-r10.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run (581 passed, 1 skipped, 83 files); pnpm deps:inventory.
- Acceptance: (1) release-r10 test: matching build verifies; changed/added file, other commit, dirty tree, other lockfile fail; (2) overprivileged, forbidden-family, executable, path-escaping, unknown-field and wrong-contract manifests are rejected; (3) the example pack's four fixtures produce fires/quiet/unknown/rejected; (4) revocation and integrity failures are tested; disconnected install, upgrade, removal and revocation are documented.
- Blocked (gate owner_release_settings): signing, build provenance attestation, tag protection and applying the branch ruleset. Nothing here changes repository settings.
- Migration/rollback: none (no database change).
- Next: owner applies or amends the proposed ruleset and decides on attestations.
