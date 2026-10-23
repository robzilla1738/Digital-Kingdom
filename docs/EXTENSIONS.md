# Extensions (R10.5)

Extensions use the `dk.extension.v1` contract in `packages/extension-sdk`. They are **declarative only**: a
connector manifest, a threshold rule definition or a scene-module description. No extension ships code, so no
extension can open a socket, read a file, start a process, call a provider or take a response action.

## Permissions

| Kind | Contract | Ceiling |
|---|---|---|
| connector | 1 | `ingest:events`, `sources:declare` |
| rule | 1 | `events:read`, `findings:propose` |
| module | 1 | `scene:render`, `graph:read` |

Asking for anything above the ceiling, any unknown permission, or anything in the network, filesystem, exec,
response, approval, token, secret or provider families rejects the extension. Executable files (`.js`, `.ts`, `.sh`,
`.wasm`, native libraries…), absolute paths and `..` are rejected. Unknown manifest fields are rejected.

## Integrity and revocation

`files` pins every file by sha256 (`pnpm extension:pin <dir>` fills it). Missing, changed or unpinned shipped files
fail `checkPack`. A `dk.extension_revocations.v1` list withdraws an `id`, an `id@version`, or one exact manifest
digest; a revoked pack is refused even when everything else is valid. To withdraw an installed extension, add it to
the revocation list and remove its directory; findings it already proposed stay in the history with its id.

## Contributor packs

A rule pack must carry four fixtures, each `{ "events": [...], "expect": ... }`:

- `positive` → `fires`
- `benign` → `quiet` (look-alike activity the rule must not flag)
- `missing_evidence` → `unknown` (matching events without the grouping field; never reported as benign)
- `failure` → `rejected` (malformed input is refused, not skipped)

`packages/extension-sdk/examples/rate-limit-rule` is a complete example, and its tests run in CI. A passing pack
shows the declared behaviour on its fixtures; it is not a validated detection.
