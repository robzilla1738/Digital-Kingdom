# R04 receipt

## R04.3 compute conditional effective-access paths

Delivered: `evaluate`, `accessPaths`, migration 14 (`access_snapshots`), snapshot and paths routes, MCP tool.

Acceptance (`apps/server/test/access-r04.test.ts`, 5 tests):
- `s3:*` allowed but the bucket explicitly denied: blocked, naming the deny.
- Unknown identity policies, unknown SCPs or an unknown bucket policy: unresolved.
- A partner in another account with only an identity allow is blocked; with a bucket policy naming it, feasible; with a conditional bucket policy, conditional with `aws:SourceIp` listed.
- Every decision is `configured_permission` with an explicit not-claimed note; the API says so too.
- Role-assumption paths: build-bot cannot PutObject directly but can through the exporter role; an SCP without S3 blocks.

Documented limits: no NotPrincipal, policy variables, ABAC tags, VPC endpoint or KMS key policies, ACLs or Block Public Access; snapshots are supplied (declared/exported), not collected from a live account.

## R04.1 source-to-running-artifact lineage

Delivered: `verifyEnvelope`, `evaluateLineage`, `digestOf`, route.

Acceptance (`apps/server/test/lineage-r04.test.ts`, 4 tests, ECDSA P-256 DSSE envelopes):
- `latest` resolving to a different digest than the build, and the runtime running it: two mismatch links and drift text.
- A valid signature from an unexpected key, a correct key id with the wrong key, an unexpected builder, or a different source commit: unverified.
- A verified chain carries a not-claimed note that provenance is not a malware or vulnerability verdict.
- Verified provenance without an observed runtime digest leaves `running_matches_commit` unknown.

Limits: pinned-key DSSE only (no Fulcio/Rekor keyless verification); registry and runtime digests are supplied by the caller or a connector, not fetched here.
