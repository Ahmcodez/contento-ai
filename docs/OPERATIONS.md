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

## 4. Stuck-job reaper

Jobs whose Postgres state says "in progress" but that have no live queue job
(a crash between a state change and the next enqueue, a Redis flush, a job
BullMQ gave up on as stalled) are found and recovered automatically by the
reaper that runs inside the worker process: re-enqueued a bounded number of
times, then failed with a clear message. See `docs/STUCK_JOB_REAPER.md` for
the design, configuration and `npm run reap` for a manual sweep.
