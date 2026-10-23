# Contributing

1. `pnpm install`, then `pnpm check` must pass before and after your change.
2. Contracts first: edit `packages/contracts/schemas/*.json` and `types.ts` together, then `pnpm generate:validators`.
3. New rules need tests for what they claim **and** what they must not claim (see `packages/detections/test`).
4. Never add a code path that writes to monitored systems, a field that lets AI assert security facts, or a renderer that uses `dangerouslySetInnerHTML`.
5. Regenerate the demo corpus with `pnpm tsx scripts/build-demo-fixture.ts` if you change the scenario.

## Extensions and regression contributions

- Rule, connector and scene-module contributions follow `docs/EXTENSIONS.md`: declarative only, permission
  ceilings, pinned files, and for rules the four fixtures (positive, benign, missing-evidence, failure).
- Regression fixtures from resolved cases come from an approved proposal (`scenarios/regressions/README.md`);
  never paste real incident data into a fixture.
- Releases follow `docs/RELEASE.md`.
