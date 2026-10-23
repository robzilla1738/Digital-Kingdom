# Release process (R10.5)

Status: the local parts are implemented and run in CI. Signing, provenance attestation, tag protection and branch
rulesets need the repository owner's release settings (roadmap gate `owner_release_settings`) and are **proposed,
not applied**. Nothing in this repository bypasses or changes repository settings.

## What every CI run records

1. `pnpm deps:inventory` regenerates `docs/THIRD_PARTY_NOTICES.md` from the lockfile (production dependencies and
   licenses). CI fails if the committed file is stale or a license outside the allow-list appears.
2. `pnpm release:manifest` writes `artifacts/release/release-manifest.json`: version, commit, whether the tree was
   clean, the `pnpm-lock.yaml` digest, Node version and the sha256 of every file in `apps/web/dist`.
3. `pnpm release:verify` recomputes the digests and fails on any added, removed or changed file, another commit, a
   dirty tree or another lockfile. The manifest is uploaded as the `release-manifest` CI artifact.

This proves a build matches what CI recorded. It is integrity, not authenticity: without a signature anyone who can
replace the manifest can replace the build.

## Cutting a release (owner)

1. Merge only CI-green commits to `main`; update `CHANGELOG.md` with the exact candidate commit, the CI run, the
   scenario receipt and every gate still open (see `docs/roadmap/STATUS.json`).
2. Tag `vX.Y.Z` on that commit. Download the run's `release-manifest` artifact and attach it to the GitHub release.
3. Anyone can check a downloaded build: check out the tag, `pnpm install --frozen-lockfile && pnpm build`, copy the
   manifest to `artifacts/release/` and run `pnpm release:verify`.

## Proposed for owner approval (not applied)

- `docs/release/branch-ruleset.proposed.json`: require pull requests and the `check` and `browser-pilot` CI jobs on
  `main`, block force pushes and deletion, require linear history. Apply it yourself in Settings → Rules.
- Artifact attestations (`actions/attest-build-provenance`) on tagged builds, which needs `id-token: write` and
  `attestations: write` permissions the workflow does not currently request.
- Signed tags by the release owner.

## Telemetry and model services

Digital Kingdom sends no usage telemetry. There is no phone-home and no opt-out because there is nothing to opt out
of; if usage telemetry is ever added it must be off by default and opt-in. No hosted model service is required: the
scene planner and every investigation path have deterministic fallbacks, and the server, detections, queries and
authorization run with no model configured.

## Disconnected installation, upgrade and removal

- Disconnected: on a connected machine run `pnpm fetch` (fills the pnpm store from the lockfile), copy the checkout
  and the store, then `pnpm install --offline --frozen-lockfile`. No runtime network access is required.
- Upgrade: stop the server, `pnpm backup` (encrypted), check out the new tag, install, start. Migrations run forward
  only on start; to roll back restore the backup with the old release (`pnpm restore`).
- Removal: stop the server, revoke issued tokens (`POST /api/tokens/:id/revoke`) and source keys, delete the data
  directory (`DK_DATA_DIR`, default `.data`), and remove any notification destinations you configured at receivers.
- Extensions: see `docs/EXTENSIONS.md` for revocation.
