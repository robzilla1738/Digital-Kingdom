# next-C — UX focus: active-environment framing and attention compaction (post-phase batch)

Branch `phase/li-next-c` from main `b0b4a20`. Source: work/next/review/STATUS_REVIEW.md §E. Recorded 2026-10-24 (CDT).
STATUS.json intentionally not edited. No model/provider calls. Web UI only (apps/web, e2e, docs).

## What changed
1. **Active-environment framing** (`apps/web/src/lib/framing.ts`). In a world with ≥2 populated environments and an
   ungrouped scene (≤50 rooms), the castle's first frame is the *active* environment: most high/critical assets, then
   most distinct findings, then most assets, then id. Implicit, presentation only: nothing is hidden, no evidence changes,
   nothing is written to the URL. An explicit world focus (navigator, toolbar buttons) always wins.
   - Shared toolbar control `WorldFraming` (`data-testid=world-framing`, Shell.tsx): `Active · <env>` and
     `Realm overview · N`. Both set the existing LP16 world focus (`wf=` in the URL), so castle, graph and navigator agree.
   - 2D/3D parity: castle (`.castle-wrap[data-framing]`) and graph (`.graph-wrap[data-framing]`) read the same
     `viewFraming()`; the graph marks `data-world-focus=member|outside` and dims non-members only for an explicit focus.
   - Grouped scenes (>50 rooms) keep their existing district overview (no implicit frame) — deliberate, to avoid changing
     LP16 scale behavior.
2. **Attention compaction** (`apps/web/src/lib/attentionGroups.ts`, AttentionPanel.tsx). Repeated low-urgency items of
   one kind (≥2) collapse into one row: exact count, subject ids, `Show all N` (aria-expanded) revealing every item as an
   ordinary card with its Acknowledge control. Never grouped: medium/high urgency, observer (coverage) gaps,
   contradictions, incomplete repairs, items with changes since acknowledgement. No item is dropped, merged,
   acknowledged or re-scored; server data/semantics untouched. Cards are denser (actions beside the text).
3. **Case focus strip** (`CaseFocus` in CasesWorkspace.tsx, `apps/web/src/lib/caseFocus.ts`). With a case open, its
   question and next evidence obligation (failed > partial > not started > unavailable; falls back to the workbench's
   next meaningful action) sit above the attention queue in the first viewport. Read-only mirror.

## Tests
- Failing-before: at commit 3d3c4f3 `pnpm vitest run apps/web/src/lib/{attentionGroups,framing,caseFocus}.test.ts`
  → 3 files failed, "Failed to load url ./framing.ts … Does the file exist?" (likewise the other two). No tests ran.
- Passing-after: 9/9 new unit tests (5 grouping incl. a 40-mix exhaustiveness check, 3 framing, 1 next-obligation).
  apps/web vitest: 29 files / 234 tests pass. `pnpm typecheck` passes.
- New e2e `e2e/focus-next-c-redesign.spec.ts` (3 tests): F15 implicit active-env frame, explicit realm overview (zoom
  drops >1.3×, label count unchanged, `wf=realm` in URL), back to env, graph parity; F01 single env shows no control;
  stale checks grouped with exact count, expand shows all, case question + next obligation inside 900px and above the
  queue. Locally all 3 passed (1.6 min) on the first run. Later local runs timed out in clicks/canvas waits while the
  2-core sandbox ran at load ≈8 (other agents + vitest); the same CPU-starvation timeouts hit unchanged suites
  (cases-redesign CONN-01/CTL-01 which never touch changed code). CI is the authority — see below.
- No existing e2e expectation was edited. LP17 F15 test: its `lp17-f15-mixed-world` capture now shows the active
  environment (intended); its navigator env-row assertion still requires a pose change (env:synthetic-design ≠ env:demo).

## Screenshots (docs/phases/local-intelligence/screenshots/next-C/, 1440×900, DPR 1, Chromium headless, SwiftShader software WebGL; .meta.json beside each)
- before-lp17-f15-mixed-world.png, before-lp30-case-workbench-desktop.png — copied unchanged from the review captures at b0b4a20 (hashes match review meta).
- after-f15-active-environment.png (commit 8fc2e72 build) — default frame on env `demo`; populated region fills the stage.
- after-f15-realm-overview.png (8fc2e72) — explicit overview; the compiled environment gap is still visible here.
- after-cases-attention-compact-no-case.png, after-cases-case-focus.png (9080c20 build, recaptured once load dropped;
  the e2e test passed on that run) — 9 open items: 3 medium cards (2 contradictions, 1 observer gap) stay individual;
  6 low stale checks collapse to one row "6 stale checks … Show all 6"; with a case open, its question and next action
  sit at the top of the first viewport. Viewed: no text overflow or clipping.

## CI
- 40132161201 (8fc2e72): check failed in `examples/reference-app/e2e.test.ts` ("expected +0 to be 10" — SDK flush
  event count; server/SDK path not touched by this branch; 983 other tests passed); browser-pilot skipped as a result.
- 40133165321 (9080c20): check passed; browser-pilot failed in the ORIGINAL pilot `F. containment stays
  proposal-only` (server snapshot of events changed between before/after: the known source-freshness timing window;
  no UI involvement). Redesign suite did not run in that job.
- **40133564904 (e13c60b, final head): success.** check passed (pnpm test incl. reference-app e2e); browser-pilot:
  original pilot 11 passed; redesign suite 113 passed / 1 skipped, including the 3 new next-C tests, LP17 F15
  (families-redesign:47) and LP30 case-workbench axe/keyboard/reduced-motion/390px.
- Local full `pnpm test` (at 8fc2e72 code): 143 files, 984 passed / 1 skipped (reference-app e2e passes locally, so the
  40132161201 failure is a timing flake).

## Limitations / remaining
- Region spacing is constrained by framing only. The compiled scene keeps its deterministic environment stride
  (packages/scene-compiler compile.ts `environmentStride`); compacting it would move pinned layouts and digests, so the
  explicit Realm overview still shows the empty gap. A presentation-only realm layout (or a reviewed reflow) is the next step.
- Implicit framing is not applied to grouped (>50 room) scenes.
- Before-case capture (review) had no case open; the after pair shows both states. The review's LP30 view itself is not re-captured by the LP30 suite here.
