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

## R04.2 contextual vulnerability applicability

Delivered: `assess` (OSV range evaluation, VEX provenance rules, KEV/EPSS context, priority with explanation), route.

Acceptance (`apps/server/test/vuln-r04.test.ts`, 4 tests, synthetic OSV-format records):
- A package only in the source dependency list is `source_only`/informational; the same advisory on a package in the running artifact is `affected_in_runtime`.
- A Debian package is `unknown` because of possible backports; a component without a version is `unknown`; a 51-day-old feed is flagged stale.
- With the fixed version running, the KEV-listed advisory is `fixed_in_runtime` with verified remediation, and the context note says KEV does not mean this installation is compromised.
- Explanations cite asset, digest prefix, exposure and authority; assumptions cite the SBOM tool and feed time; unsigned or unreviewed VEX is ignored, reviewed signed VEX downgrades.

External gate still open: live feed access (`external_feed_access`). Reachability analysis is not done.

## R04.4 replace target-only posture with a real security change diff

Delivered: `reviewChange`, `ChangeReviews` (create, ownerReview, postDeploy, get), routes.

Acceptance (`apps/server/test/change-r04.test.ts`, 4 tests):
- A candidate adding `s3:*` on `*` turns a blocked probe feasible and lists the new wildcard allow, with zero findings involved.
- A missing candidate snapshot keeps the posture review_required with an unknown-authority reason; a new edge-reachable service without telemetry is new_ingress and lost_telemetry. An identical candidate is 'no material change found', explicitly not 'safe'.
- A different candidate digest cannot be accepted against the old review (409); the review's author cannot accept it.
- Post-deploy with the reviewed digest matches; another digest is drift naming both.

Limits: probes must be supplied for grant comparison (plus wildcard detection); ingress is computed from the declared graph.
