# Stuck-job reaper

Postgres says what state a job is in; BullMQ/Redis is what actually moves it
forward. When the two disagree, a job sits in a non-terminal state forever and
the user just sees a spinner. The reaper (`src/workers/stuckJobReaper.js`)
finds and repairs those.

## What it catches

| Situation | Why nothing else recovers it |
|---|---|
| A process dies between a state change and the next `queue.add` (e.g. `AUDIO_EXTRACTED` written, transcription never enqueued; or the API dies after creating an `UPLOADED` job) | The next job was never created |
| Redis is flushed or restored from an old snapshot | Queue jobs are gone, rows are not |
| BullMQ fails a job as "stalled more than allowed" | That failure comes from BullMQ, not our processor, so `wrapWithErrorPersistence` never updates the row |

A crashed worker whose job is still in Redis is **not** the reaper's job:
BullMQ's own stalled-job recovery handles it (~90s, see `QUEUE_STALLED_INTERVAL_MS`).

## How a sweep works

1. One cheap Postgres query: non-terminal `processing_jobs` / `media_imports`
   rows untouched for `REAPER_STUCK_AFTER_MS`. If none, **Redis is never touched**.
2. If there are candidates: take a Redis lock (`reaper:lock`) so only one
   process sweeps at a time, then read each affected physical queue once and
   build a set of live `(job name, id)` pairs (waiting / active / delayed /
   prioritized / waiting-children / paused). A job with a live queue job is left alone,
   including one waiting out a retry backoff.
3. For each row with no live job, claim it atomically
   (`UPDATE ... WHERE state = ? AND updated_at < cutoff`) so two reapers cannot
   both act on it, then:
   - **re-enqueue** the stage that should be running, with the same payload its
     normal producer would have built (rebuilt from the DB) and the normal retry
     policy, recording a `{reaper: "requeued"}` event; or
   - once `REAPER_MAX_REQUEUES_PER_STAGE` re-enqueues for that state are used up,
     mark it `FAILED` with "Processing was interrupted and could not be
     recovered. Please try again." plus a `processing_errors` row.

If Redis cannot be read, the sweep does nothing for those rows. "Unknown" is
never treated as "dead".

## State to stage

Every in-progress pipeline state maps to the stage whose queue job should exist
(`PIPELINE_STATE_TO_STAGE`), e.g. `VALIDATED`/`EXTRACTING_AUDIO` -> `audio.extract`,
`CLIPS_SCORED`/`RENDERING_CLIPS` -> `clip.render`. URL imports:
`DETECTING_PROVIDER`/`FETCHING_METADATA` -> `url-import.resolve`,
`DOWNLOADING` -> `url-import.download`.

Deliberately not re-run: `VALIDATING_MEDIA` (the download already finished and
whether the asset was created is unknowable from here, so it is failed; the
user's retry dedupes by checksum) and `WAITING_CONFIRMATION` / `UPLOADING`
(waiting on a person, not a queue).

Re-running a stage is safe because transcript, analysis and clip-candidate
persistence replace rather than collide on a second run, and rendering and
content generation already upserted.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `REAPER_ENABLED` | `true` | Run the reaper inside the worker process |
| `REAPER_INTERVAL_MS` | `60000` | Time between sweeps |
| `REAPER_STUCK_AFTER_MS` | `300000` | Row must be untouched this long to be considered |
| `REAPER_MAX_REQUEUES_PER_STAGE` | `2` | Re-enqueues per job per state before failing it |

Worst-case time to recover a lost job is about `REAPER_STUCK_AFTER_MS + REAPER_INTERVAL_MS`.
Running several worker processes is fine.

## Running it by hand

`npm run reap` does one sweep and prints the counts, which is useful straight
after restoring Redis. It honors the same settings; set `REAPER_STUCK_AFTER_MS=1000`
to include recently touched rows.

## Metrics and logs

Counters `reaper_requeued{stage}` and `reaper_failed{state}`; a `warn` log line
per recovered job and an `info` summary per sweep that did anything.
