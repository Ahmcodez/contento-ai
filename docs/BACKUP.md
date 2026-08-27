# Backup & Recovery

## What needs backing up

| Data | Where | Criticality |
|---|---|---|
| Relational data (users, projects, transcripts, clip metadata, generated content, usage ledger) | Postgres | Critical — system of record, nothing else has it |
| Media binaries (uploads, rendered clips, thumbnails) | Object storage (local disk in dev, S3-compatible in prod) | High — expensive to regenerate (re-upload + re-run the whole pipeline), but not unrecoverable metadata loss |
| Job queue state | Redis | Low — deliberately not durable business data (see below) |

## Why Redis needs no backup strategy

Every BullMQ job's business-meaningful result is persisted to Postgres
independently of the queue (docs/QUEUE.md §6, step 5 of the idempotency
pattern) before a processor acknowledges the job. Redis is treated as
disposable: if it's lost, in-flight jobs are lost, but no completed data
is. The fix for a lost Redis instance is "the affected jobs need to be
re-run," not "restore from backup." This is intentional (ADR-004
tradeoffs) and is why the task's instruction to "not store permanent
business data only in Redis" is already satisfied by the architecture,
not just a backup policy.

## Postgres backup strategy

**Managed provider backups (recommended, do this first):**
Both Neon and Supabase (the recommended providers, see
`docs/DEPLOYMENT.md`) include automatic daily backups with point-in-time
recovery on their free/low tiers — Neon via branching + PITR, Supabase via
daily automated backups. Enabling this is a dashboard setting, not
infrastructure to build. For any real deployment, this should be
step one, before anything below.

**Manual backup (self-hosted Postgres, or a portable backup outside the
managed provider):**
```bash
pg_dump "$DATABASE_URL" --format=custom --file=contento-backup-$(date +%Y%m%d).dump
```
Restore:
```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" contento-backup-YYYYMMDD.dump
```

**Recommended schedule for a self-managed instance**: daily full dump,
retained 14 days, stored somewhere other than the same host (e.g. the
same S3-compatible bucket used for media, under a `backups/` prefix —
cheap, and keeps recovery credentials/tooling to one provider).

## Object storage backup strategy

- **Local disk (dev only)**: not backed up — this is development data by
  definition. Losing it means re-uploading test videos, which is
  expected and low-cost.
- **S3-compatible (production)**: enable versioning on the bucket
  (supported by AWS S3, Backblaze B2, and Cloudflare R2) rather than a
  separate backup pipeline — this protects against accidental overwrite/
  delete with no additional infrastructure, and every write in this
  codebase uses a unique, server-generated key (`docs/SECURITY.md` §3),
  so accidental overwrites should be rare by construction, not just by
  luck.

## Recovery scenarios

**Database corruption / accidental bad migration**: restore the most
recent Postgres backup (managed-provider PITR is fastest — restore to a
point just before the bad migration ran), then re-apply any migrations
that came after that point.

**Lost Redis instance**: no restore needed. Restart Redis, restart the
worker. Jobs that were in-flight (not yet reached a terminal state in
Postgres) should be identified via
`SELECT * FROM processing_jobs WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED') AND updated_at < now() - interval '1 hour'`
and either manually re-enqueued from their last known state or,
simpler, marked `FAILED` with a note to the affected users to re-upload —
there is no automatic "stuck job reaper" yet (documented gap, see
`docs/SCALABILITY.md` future-work framing).

**Lost object storage bucket**: relational data survives (Postgres is
independent), but every `storage_key` reference becomes a dangling
pointer. Media playback/download breaks for existing content; the
pipeline for *new* uploads is unaffected once a working bucket is
reconfigured. There is no automated re-render-everything recovery path —
for anything beyond a handful of affected jobs, this would need a
one-off script re-running the render/thumbnail stages for jobs whose
`generated_clips.storage_key` no longer resolves.

**Accidental data deletion via the API** (e.g. a user archives/deletes a
project): by design, `DELETE /projects/:id` archives rather than hard-
deletes (`docs/DATABASE.md` — "archived, not deleted, on user delete
action in V1"). Recovery is a direct DB update
(`UPDATE projects SET status = 'active' WHERE id = ...`) with no data
ever actually lost. True hard-delete (e.g. a GDPR erasure request) is out
of scope for V1 and would need its own reviewed, audited path before
being built — not something to improvise via a manual `DELETE` under
pressure.

## What's explicitly not implemented (known gaps, stated plainly)

- No automated backup verification / restore drills. The commands above
  are documented but not exercised on a schedule.
- No automated "stuck job" detection/recovery (see the Redis-loss
  scenario above).
- No cross-region replication for either Postgres or object storage — not
  justified at this project's current scale (`docs/SCALABILITY.md`).
