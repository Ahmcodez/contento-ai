# Operations

Referenced from `scripts/cleanup.js` and `src/workers/index.js`, which
pointed here before this file existed — found and fixed in a production-
readiness review (`docs/RELEASE_READINESS.md`).

## 1. Scheduled maintenance (`scripts/cleanup.js`)

Not part of the request-serving hot path — run manually or on a schedule.
Everything it does is safe to run repeatedly and safe to run concurrently
with the live app (no locks it needs to coordinate with):

```bash
cd backend && npm run cleanup
```

What it does:
- Deletes expired refresh tokens, and revoked ones older than 7 days
  (kept briefly for forensic investigation of suspicious refresh activity,
  not purged immediately on revoke).
- Removes orphaned local-disk temp files older than 6 hours — a safety
  net for a process that crashed mid-upload/render (normal operation
  always cleans up its own temp files via `finally` blocks; this only
  catches what that missed).

Recommended schedule: daily, via cron or your platform's scheduled-job
feature. Not currently automated inside `docker-compose.yml` (dev-only,
per its own header comment) — wire this into whatever scheduler the real
deployment target provides (see `docs/DEPLOYMENT.md`).

## 2. Structured logging spec

Every pipeline stage (`src/workers/index.js`'s `wrapWithErrorPersistence`
wrapper, applied to every processor) logs three lines per job, via a
`logger.child()` carrying consistent fields:

- `stage started` — `{ stage, jobId, processingJobId }`
- `stage completed` — adds `durationMs`
- `stage failed` — adds `durationMs`, `err`, `attemptsMade`

All structured JSON via pino (`src/logger/index.js`), with `password`,
`token`, `apiKey`, `secret`, and similar fields redacted automatically —
safe to ship these logs to any external aggregator without a separate
scrubbing step.

## 3. Queue / job observability

`GET /api/v1/admin/queues` (added in the same production-readiness pass
that created this file) returns real per-queue job counts
(waiting/active/completed/failed/delayed/paused) via BullMQ's own
`getJobCounts()` — gated by the `ADMIN_API_KEY` env var (unset = the
route is disabled/404, not open). Useful for answering "is anything
stuck?" without a database or Redis CLI session:

```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" https://your-api-host/api/v1/admin/queues
```

This is intentionally minimal — real counts, not a dashboard. A fuller
UI (e.g. Bull Board) is a reasonable future addition, not built yet.

## 4. Known gap: no automatic stuck-job reaper

A job can end up orphaned — e.g. a worker process is killed (OOM,
deploy, host failure) mid-stage, after BullMQ has marked the job active
but before `wrapWithErrorPersistence`'s failure path ever runs. Nothing
currently detects and recovers that job automatically; it will sit in a
non-terminal state until someone notices (via §3 above, or a direct
query) and manually intervenes. This has been a known, deliberate,
documented gap since the project's original handoff notes and remains
one — see `docs/RELEASE_READINESS.md` for it being carried forward
rather than silently dropped.
