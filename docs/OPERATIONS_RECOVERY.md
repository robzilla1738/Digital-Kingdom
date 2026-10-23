# Operations: failure behaviour, backup and recovery

Measured on 2026-10-22 with `pnpm soak 100000` (Neoverse-V2 ARM64, 2 cores, 8 GB, Node 22, local SSD). Your numbers
will differ; rerun the script on your hardware before relying on them.

| Measure | Result |
|---|---|
| Events offered (three sources, one sending 80%) | 100,000 |
| Accepted / refused by per-source budget (noisy source at 50,000/min) | 70,000 / 30,000 (all refusals from the noisy source; both quiet sources fully admitted) |
| Durable ingest rate (single process) | about 9,400 events/s |
| Normalization + detection rate | about 3,500 events/s |
| Database size | 133 MB |
| Encrypted backup (AES-256-GCM, `VACUUM INTO` snapshot) | 0.7 s, 126 MB |
| Verified restore (decrypt, digest, integrity, references) | 1.0 s |

## What the server does under failure

- **A noisy source** is refused with `429 Retry-After: 30` once it exceeds its rolling-minute budget (default 6,000;
  `sourceBudgetPerMinute`). Refusals are counted as `rejected:throttled` in project health and summarized in recent
  rejections. Other sources keep their own budget.
- **A full backlog** (default 200,000 unprocessed records, `maxBacklog`) answers `503 Retry-After: 5` to every
  source until the worker catches up. Nothing is dropped silently; the sender must retry.
- **Disk full** answers `503 Retry-After: 30` with nothing written; the checkpoint and integrity are unchanged, and
  ingestion resumes when space returns (tested with `PRAGMA max_page_count`).
- **A crash during processing** rolls the whole batch back; the checkpoint does not move and the batch is processed
  again on restart. Duplicate deliveries are recognized by `(source, source_event_id)`.
- **A revoked or re-keyed source** is refused with 401; its stored history is kept.

## Backup and restore

```bash
DK_DATA_DIR=.data DK_BACKUP_PASSPHRASE='at least twelve chars' pnpm backup          # writes dk-<time>.dkb (mode 600)
DK_BACKUP_IN=dk-....dkb DK_RESTORE_TO=/new/path/digital-kingdom.db DK_BACKUP_PASSPHRASE=... pnpm restore
```

Backups can run while the server is up. Restore never overwrites an existing file and exits non-zero unless
integrity, foreign keys, finding-to-event references, checkpoint bounds and table counts all verify. Point
`DK_DATA_DIR` at the restored directory to start from it. Keep the passphrase outside the backup location;
without it the backup cannot be read.

## RPO and RTO (assumptions, not guarantees)

- **RPO** equals your backup interval: data accepted after the last backup is lost if the disk is lost. Sources
  that buffer and retry (the Node SDK queue, an OpenTelemetry Collector sending queue) can resend events refused
  during an outage, but not events the server had already accepted before a disk loss.
- **RTO** for a 133 MB database is about one second to restore plus server start; scale roughly with size.
- The journal is never pruned to meet these numbers. Retention is a separate, documented setting.
