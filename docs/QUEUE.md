# Queue Architecture (BullMQ / Redis)

## 1. Queues and job types

One BullMQ **queue per pipeline stage** (not one giant queue) — this gives
independent concurrency control and independent observability per stage,
which matters because stages have very different cost/latency profiles
(FFmpeg work is CPU-bound and local; AI calls are I/O-bound and rate-
limited by an external provider).

| Queue name          | Job name           | Triggered after state | Produces state    | Concurrency (dev default) |
|----------------------|----------------------|--------------------------|----------------------|-----------------------------|
| `video-validate`      | `video.validate`      | UPLOADED                  | VALIDATED             | 2                             |
| `audio-extract`        | `audio.extract`        | VALIDATED                 | AUDIO_EXTRACTED        | 2                             |
| `transcription-process`  | `transcription.process`  | AUDIO_EXTRACTED           | TRANSCRIBED            | 1 (external API, rate-limited) |
| `content-analyze`         | `content.analyze`        | TRANSCRIBED                | ANALYZED                | 2                             |
| `clips-detect`              | `clips.detect`             | ANALYZED                    | CLIPS_FOUND              | 2                             |
| `clips-score`                  | `clips.score`                 | CLIPS_FOUND                    | CLIPS_SCORED               | 4 (cheap, deterministic)        |
| `clip-render`                     | `clip.render`                    | CLIPS_SCORED (fanned out per clip) | contributes to CLIPS_RENDERED | 2 (CPU-bound, tune to host cores) |
| `content-generate`                    | `content.generate`                  | ANALYZED (fanned out per content type, parallel with clip pipeline) | contributes to CONTENT_GENERATED | 3 |
| `job-finalize`                            | `job.finalize`                          | CLIPS_RENDERED + CONTENT_GENERATED (join) | COMPLETED | 2 |

## 2. DAG (dependency graph, not strictly linear)

```
video.validate → audio.extract → transcription.process → content.analyze
                                                              │
                                        ┌─────────────────────┴─────────────────────┐
                                        ▼                                           ▼
                                clips.detect → clips.score → clip.render (×N, fanned out)   content.generate (×5, fanned out)
                                        │                                           │
                                        └─────────────────────┬─────────────────────┘
                                                              ▼
                                                       job.finalize → COMPLETED
```
`clip.render` and `content.generate` run **in parallel** — clip rendering
doesn't block written content, and vice versa. `job.finalize` is a join
point that waits for both branches to reach a terminal state (success or
partial failure) before running. Implemented with BullMQ's `FlowProducer`
(parent/child job trees) rather than hand-rolled polling for completion.

## 3. Retry strategy

Configured per queue, not globally — matches the failure-class table in
`docs/PIPELINE.md`:

```ts
// packages/queue/src/config.ts (illustrative — no implementation yet)
{
  'transcription-process': {
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },  // 5s, 10s, 20s, 40s
  },
  'content-analyze': {
    attempts: 4,
    backoff: { type: 'exponential', delay: 3000 },
  },
  'clips-detect': {
    attempts: 4,
    backoff: { type: 'exponential', delay: 3000 },
  },
  'clip-render': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
  'content-generate': {
    attempts: 4,
    backoff: { type: 'exponential', delay: 3000 },
  },
  'video-validate': { attempts: 1 },       // deterministic — no retry
  'clips-score': { attempts: 2, backoff: { type: 'fixed', delay: 1000 } },
  'job-finalize': { attempts: 3, backoff: { type: 'fixed', delay: 2000 } },
}
```

A processor that catches a **non-retryable** error class (quota exceeded,
deterministic validation failure) explicitly throws BullMQ's
"unrecoverable error" so it skips remaining attempts even if `attempts >
1` — the attempts count is a ceiling for transient failures, not a blanket
retry-everything policy.

## 4. Dead-letter handling

BullMQ jobs that exhaust all attempts move to the `failed` set
automatically. On top of that:
- A processor's final failure handler writes a `ProcessingError` row and
  transitions the `ProcessingJob` to `FAILED` — the DB is the source of
  truth for "this needs human/user attention," not the Redis failed set
  (which is operational, not durable long-term).
- A scheduled sweep job (`queue-monitor`, low frequency, e.g. every 5 min)
  checks for jobs stuck in the BullMQ `failed` set older than a threshold
  and alerts (logs at `error` level; wired to a paging/notification
  channel only once real infra exists — not in V1).
- Bull Board (self-hosted, free) is the primary manual dead-letter
  inspection tool in V1 — no custom DLQ UI is built.

## 5. Concurrency

Concurrency is per-worker-process, per-queue, set via `Worker` options and
overridable via env (`QUEUE_CONCURRENCY_TRANSCRIPTION`, etc.) — see
`docs/COST.md` for why transcription/AI-facing queues default to low
concurrency (protects both external rate limits and the wallet) while
CPU-bound FFmpeg queues default to `min(cpuCount, N)`.

## 6. Idempotency (implementation detail, expands `docs/PIPELINE.md` §5)

Every job payload is a typed contract from `packages/queue/src/contracts.ts`
containing at minimum `{ processingJobId, ...stageSpecificNaturalKey }`.
Processors follow this pattern uniformly:

```
1. Load current ProcessingJob state from DB.
2. If state is already past this stage (e.g. job somehow re-queued after
   already completing) → no-op, ack immediately.
3. If a result row already exists for the natural key (e.g. Transcript
   for this mediaAssetId+checksum) → reuse it, skip the paid call, still
   perform the state transition.
4. Otherwise do the real (possibly paid) work.
5. Persist result + transition state inside a single DB transaction.
```
Step 5 being transactional matters: a crash between "got the AI result"
and "wrote the state transition" must not leave the job stuck — on retry,
step 3's check finds the already-persisted result (if the transaction
committed) or safely redoes the call (if it didn't).

## 7. Job progress

Each processor reports incremental progress via BullMQ's built-in
`job.updateProgress()` for long-running stages (`clip.render`,
`transcription.process`) — e.g. percent-through-fanned-out-sub-jobs. The
API's job-status endpoint (`GET /api/v1/jobs/:jobId`) blends the coarse
pipeline `state` with this fine-grained progress to compute
`progressPercent` for the UI, rather than exposing raw BullMQ internals
over the public API.

## 8. Fan-out / fan-in mechanics

`clip.render` and `content.generate` are fanned out using BullMQ
`FlowProducer` children under a parent job (`clip-render-batch` /
`content-generate-batch`), so:
- Each child is independently retryable without re-running its siblings.
- The parent naturally becomes "ready" only once all children reach a
  terminal state, giving fan-in for free instead of hand-rolled counting
  logic in application code.
