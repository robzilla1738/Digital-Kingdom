# Recorded evaluation and pending review

The full run completed 408/408 attempts without a halt. This directory preserves its report, manifest, summary, frozen registration, answer packet, coordinator map and source hashes. All data are synthetic.

Human review is **pending**. The 132 selected answers include all 59 flagged attempts and a seeded sample of unflagged attempts. Inspect the original evidence and transcripts before assigning semantic support. A completed model response is not a successful investigation: 41 attempts were unsuccessful under the automatic objective criteria.

Raw transcripts remain locally under `artifacts/eval-v2/completion/full-2026-10-23T14-31-15-093Z/` (ignored by Git). Coordinator transcript paths are relative to this directory. The source index preserves original file hashes. The 36-attempt development run and 13-attempt interrupted launch remain separate; neither replaces full-run attempts. The interrupted launch stopped during regression preflight, before held-out calls, and exposed an evidence-response-envelope comparison bug that was fixed before the recorded full run.

The shared ledger is $0.939669258 with no outstanding reservations, against a $5 cap and $4 stopping threshold. It includes development, the interrupted launch and the full run. This is recorded/conservative API usage, not a provider invoice.

The manifest records revision `9fdb4f2` and `dirty: true`: untracked completion screenshots and documentation were present. Subsequent UI-only changes did not change the running evaluation's cases, prompts, scoring objectives or model configuration. See the registration amendment log for harness changes preceding held-out calls.
