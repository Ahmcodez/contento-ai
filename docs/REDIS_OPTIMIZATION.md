# Redis & query optimization audit

Measured on BullMQ 5.81.3 / ioredis 5.11 / Redis 7.0.15, using `redis-cli MONITOR`
with per-operation markers. "Client-issued" = commands the app sends (what a
provider that bills the outer `EVAL`/`EVALSHA` counts). "Total" also includes
commands Redis runs *inside* BullMQ's Lua scripts (`INFO commandstats`).
Numbers below are from a local Redis, not from a managed provider.

## Why the command counter climbs

It is time-driven, not click-driven. Each of the 10 workers loops forever:
block on `BZPOPMIN <queue>:marker` for `drainDelay` seconds (BullMQ default 5),
time out, run the `moveToActive` script (~6 internal commands), block again —
plus a stalled-job sweep every `stalledInterval` (30s). 10 queues x that loop
is **260 client-issued / 1,100 total commands per minute with zero jobs**.

Frontend actions are nearly free on the Redis side:

| Operation | Redis commands | Why |
|---|---|---|
| Any API request | 1 | rate limiter (`EVALSHA`) |
| register / login / refresh | 2 | general + auth limiter |
| Click "New Project" | 0 | client-side navigation only |
| Title + Next (`POST /projects`) | 1 | rate limiter; project write is Postgres only |
| Job status poll (every 3s) | 1 | rate limiter |
| One job through 3 stages | ~21 | enqueue next stage + BullMQ bookkeeping |

The API process is idle at 0 commands/min (queues are created lazily).

## Changes

- Workers pass `drainDelay` (default 30s, `QUEUE_DRAIN_DELAY_SECONDS`) and
  `stalledInterval` (default 30s, unchanged, `QUEUE_STALLED_INTERVAL_MS`).
  Verified in the installed BullMQ source: new jobs wake a blocked worker via
  the marker key, and pending delayed/retry jobs shorten the block to their due
  time, so a larger `drainDelay` only lowers the idle heartbeat. Measured cost:
  delayed/retry jobs fire ~40-70ms later than before; new-job pickup is unchanged.
- Postgres: `/auth/me` and `/usage` no longer re-read the user row that
  `requireAuth` already loaded; the per-request auth lookup selects 4 columns
  instead of `select *` (it was loading `password_hash` on every request); the
  job status poll checks ownership in one query instead of two.

## Results (same harness, before -> after)

| Metric | Before | After |
|---|---|---|
| Idle worker, client-issued / min | 260 | 60 |
| Idle worker, total incl. Lua / min | 1,100 | 300 |
| New job pickup while idle | 3ms | 3ms |
| Delayed job (4000ms) ran at | 4007ms | 4045-4078ms |
| Retry backoff (3000ms) fired at | 3019ms | 3055-3091ms |
| Worker shutdown after SIGTERM | — | 0.1s |
| Crash recovery (SIGKILL mid-job) | ~90s | ~90s (unchanged) |
| `GET /auth/me` user reads | 2 | 1 |
| `GET /usage` user reads | 2 | 1 |
| `GET /jobs/:id` queries | 3 | 2 |

## Deliberately not changed

- `stalledInterval`: 60s measured at ~120s crash recovery (vs ~90s) for only
  ~10 fewer commands/min. Not worth slowing recovery; the knob exists.
- `lockDuration`, `maxStalledCount`, retries/backoff, `removeOnComplete/Fail`:
  reliability settings, untouched.
- Rate limiter: 1 command/request is the cost of a shared limiter.
- Worker state-transition writes (4 round trips each): the durable state
  machine; proportional to real transitions, no N+1 found.

## Queue consolidation (10 -> 5 workers)

Each worker loop costs the same (6 client-issued + 24 Lua commands/min) whatever
the queue does, so idle cost = number of workers. A workload audit (see
`docs/QUEUE.md` §1) found that only compatible stages can share: light
(validate/audio/finalize/url-resolve) and the three AI stages. Render,
transcription and download stay isolated (72 s per 60 s clip, Whisper RAM/CPU,
untrusted 15-minute downloads). One single queue was rejected: it would put
seconds-long jobs behind minutes-long CPU jobs and remove per-resource scaling.

| Metric (same harness) | 10 workers | 5 workers |
|---|---|---|
| Idle, client-issued / min | 60 | **30** |
| Idle, total incl. Lua / min | 300 | **150** |
| Redis connections | 23 | 13 |
| Startup commands (12 s) | 212 | 107 |
| Shutdown after SIGTERM | 0.1 s | 0.1 s |
| vs. original code (before any tuning) | 260 / 1,100 | 30 / 150 (-88% / -86%) |

Verified on the consolidated worker: full test suite; a real 45 s video through
all 10 stages to `COMPLETED` in 43 s (2 clips rendered 1080x1920, 5 content
pieces, 0 errors; test-only fake whisper CLI + fake AI provider, real FFmpeg);
and a `SIGKILL` of the whole worker process group mid-`audio-extract` on the
shared queue: a fresh worker resumed the job ~1 min later and it completed with
0 errors.

Known tradeoff: in a shared queue a burst of long jobs can delay a short one
(bounded by the longest job in that group: ~20 s in light, ~1 min in AI).

### Rolling out

Jobs already sitting in the seven folded-away queues must be moved once:

1. stop the OLD worker gracefully (SIGTERM; active jobs finish)
2. `npm run queues:migrate -- --dry-run`, then `npm run queues:migrate`
3. start the NEW worker
4. optionally `npm run queues:migrate -- --obliterate` to delete the empty legacy keys

The script refuses to run while an old worker is attached (or if that can't be
verified, unless `--force`), copies before removing (a crash can duplicate, never
lose; stage handlers are idempotent), and keeps each job's remaining retry budget
and due time. Failed jobs stay put (the durable record is Postgres).
`GET /admin/queues` now returns the 5 physical queues with exact counts plus a
per-stage breakdown (bounded scan, flagged `stagesTruncated` past 200 per state).

## Remaining floor

30 client-issued/min (~43k/day) for 5 idle loops. Going lower would require
merging isolated resource classes, which is not worth the risk. Managed-Redis
free tiers may still be exceeded: check your provider's billing model.

## Re-measuring

`npm run redis:rate -- 65` (leave the worker idle; window must exceed the
`drainDelay`). Known minor item: `media_assets(uploaded_by)` has a duplicate index.
