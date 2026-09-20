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

## Remaining floor and the next lever

10 queues = 10 independent idle loops. At 30s that is ~60 client-issued/min
(~86k/day). Going lower needs fewer loops: e.g. one `pipeline` queue with a
single Worker dispatching on `job.name`. That changes per-stage concurrency
(transcription is limited to 1 today), admin queue metrics, and in-flight job
migration, so it is a design decision, not a tuning tweak.

## Re-measuring

`npm run redis:rate -- 65` (leave the worker idle; window must exceed the
`drainDelay`). Known minor item: `media_assets(uploaded_by)` has a duplicate index.
