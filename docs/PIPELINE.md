# Video Processing Pipeline — State Machine

This defines the full lifecycle of a `ProcessingJob`, from upload to
finalization: states, valid transitions, failure handling, retries, and
idempotency. This is the authoritative source for `packages/core/pipeline`.

## 1. States

```
UPLOADING
  → UPLOADED
    → VALIDATING
      → VALIDATED
        → EXTRACTING_AUDIO
          → AUDIO_EXTRACTED
            → TRANSCRIBING
              → TRANSCRIBED
                → ANALYZING
                  → ANALYZED
                    → FINDING_CLIPS
                      → CLIPS_FOUND
                        → SCORING_CLIPS
                          → CLIPS_SCORED
                            → RENDERING_CLIPS
                              → CLIPS_RENDERED
                                → GENERATING_CONTENT
                                  → CONTENT_GENERATED
                                    → FINALIZING
                                      → COMPLETED

  (any state) → FAILED        (terminal, unless retried → returns to the
                                failing state)
  (any state) → CANCELLED     (terminal, user-initiated)
```

Each arrow is a single BullMQ job (see `docs/QUEUE.md` for the job↔state
mapping). A `ProcessingJob` row in Postgres always holds the *current*
state; a `ProcessingJobEvent` table (append-only) holds full state
history, including every failure and retry, for observability and
debugging.

## 2. State groups (for UI purposes)

The UI does not need to understand every micro-state — it groups them:

| Group                | States                                                          | User-facing label            |
|-----------------------|------------------------------------------------------------------|-------------------------------|
| Uploading              | UPLOADING, UPLOADED                                               | "Uploading your video"        |
| Preparing              | VALIDATING, VALIDATED, EXTRACTING_AUDIO, AUDIO_EXTRACTED            | "Preparing your video"        |
| Transcribing           | TRANSCRIBING, TRANSCRIBED                                           | "Transcribing audio"          |
| Analyzing              | ANALYZING, ANALYZED, FINDING_CLIPS, CLIPS_FOUND, SCORING_CLIPS, CLIPS_SCORED | "Finding the best moments" |
| Rendering              | RENDERING_CLIPS, CLIPS_RENDERED                                     | "Creating your clips"         |
| Writing                | GENERATING_CONTENT, CONTENT_GENERATED                               | "Writing your content"        |
| Finishing              | FINALIZING                                                          | "Wrapping up"                 |
| Done / Failed / Cancelled | COMPLETED / FAILED / CANCELLED                                   | terminal                      |

This mapping is what the frontend polls against — it doesn't need to know
about `CLIPS_SCORED` vs `RENDERING_CLIPS` internally, just the group and a
percentage estimate.

## 3. Stage-by-stage detail

### 3.1 UPLOADING → UPLOADED
- Triggered synchronously by the API as the client streams/multiparts the
  file to storage (chunked upload, resumable — see API doc). The API
  creates the `MediaAsset` + `ProcessingJob` row in `UPLOADING` as soon as
  the upload starts, and flips to `UPLOADED` once the file is fully
  persisted to the `StorageDriver` and a checksum is verified.
- **Failure**: incomplete upload (client disconnect) → job marked
  `FAILED` with `failureStage=UPLOADING`, partial file deleted from
  storage. User can retry by re-uploading (new job — uploads are not
  resumed mid-file in V1; chunked-resumable upload is a documented
  future improvement, not built in V1).

### 3.2 VALIDATING → VALIDATED
- First **worker** job (`video.validate`), decoupled from the HTTP request
  the moment the file exists in storage. Runs `ffprobe` to check: real
  video file (not spoofed extension), duration within
  `MAX_VIDEO_DURATION_SECONDS`, file size within `MAX_UPLOAD_SIZE_MB`
  (re-verified server-side, not trusted from the client), codec is
  processable.
- **Failure**: any check fails → `FAILED`, `failureStage=VALIDATING`,
  user-facing message specific to the failed check (e.g. "Video exceeds
  the 60-minute limit on your plan"). **Not retried automatically** — this
  is a deterministic rejection, retrying won't change the outcome.

### 3.3 EXTRACTING_AUDIO → AUDIO_EXTRACTED
- `audio.extract` job. FFmpeg extracts a mono, normalized-loudness audio
  track (format chosen for the transcription provider, e.g. 16kHz WAV) to
  storage, linked to the `MediaAsset`.
- **Failure**: FFmpeg crash/corrupt input → retryable (transient — could be
  a worker resource issue) up to N times with backoff; if still failing,
  `FAILED`, `failureStage=EXTRACTING_AUDIO`.

### 3.4 TRANSCRIBING → TRANSCRIBED
- `transcription.process` job. Calls the `TranscriptionProvider`. Persists
  a `Transcript` (full text) and `TranscriptSegment[]` (timestamped,
  the granularity the provider returns — word or sentence level).
- **Idempotency**: job payload includes `mediaAssetId` + a
  content-checksum; if a `Transcript` already exists for that checksum
  (e.g. job retried after a crash post-completion but pre-ack), the
  worker short-circuits and reuses it instead of re-calling the paid API.
  This is the single most important idempotency guard in the pipeline,
  since transcription is one of the two paid, external-API stages.
- **Failure**: provider error/timeout → retryable with backoff (external
  API transient failures are the common case here); provider quota
  exceeded → `FAILED` immediately, no retry (retrying won't help), clear
  user message.

### 3.5 ANALYZING → ANALYZED
- `content.analyze` job. Sends the transcript (chunked if it exceeds the
  provider's context window — deterministic chunking logic, not AI) to
  the `AIProvider.analyzeContent()` to get a structured summary: topics,
  key quotes, overall themes. Stored as `ContentAnalysis` (JSONB +
  extracted structured fields).
- **Failure**: retryable (transient AI API errors) with capped retries;
  exhausted retries → `FAILED`, `failureStage=ANALYZING`.

### 3.6 FINDING_CLIPS → CLIPS_FOUND
- `clips.detect` job. Uses the transcript + `ContentAnalysis` to identify
  candidate moments via `AIProvider.generateStructuredOutput()` constrained
  to a `ClipCandidate[]` schema (start/end timestamps, a rationale, a
  suggested title). **Deterministic post-processing** (not AI) then:
  clamps timestamps to valid transcript bounds, merges overlapping
  candidates, enforces `MAX_CLIPS_PER_VIDEO`, drops any candidate whose
  duration is out of an allowed clip-length range. This is a clear
  example of §7's "AI proposes, code validates" pattern.
- **Failure**: same retry pattern as 3.5. If zero valid candidates survive
  post-processing, this is *not* a failure — it's a valid outcome
  (`CLIPS_FOUND` with an empty set), surfaced to the user as "no strong
  clip moments found," pipeline continues to content generation since
  written content doesn't depend on clips.

### 3.7 SCORING_CLIPS → CLIPS_SCORED
- Can be AI-assisted (a virality/quality score with rationale) but is
  primarily **deterministic**: a weighted score combining AI-provided
  signal with rule-based signals (clip length closeness to ideal,
  position in video, presence of a clear sentence boundary at cut points).
  Kept as its own stage (rather than folded into 3.6) because scoring
  logic is expected to iterate rapidly post-launch and benefits from being
  independently testable/re-runnable without re-calling the LLM.
- **Failure**: purely deterministic — failure here indicates a bug, not a
  transient condition. Retried once (guards against worker OOM/crash),
  then `FAILED` and logged as a priority bug, not a user-facing "try
  again" state.

### 3.8 RENDERING_CLIPS → CLIPS_RENDERED
- `clip.render` job — **fanned out**, one sub-job per clip candidate that
  survived scoring (parallelizable, bounded by `MAX_CLIPS_PER_VIDEO` and
  worker concurrency). FFmpeg cuts the segment, reframes to 9:16
  (deterministic crop/pad strategy — see ADR on captions/reframing
  approach, to be written at implementation time once a specific
  face-tracking-vs-center-crop decision is made), burns in captions from
  the transcript segments covering that time range, generates a
  thumbnail. Output persisted as `GeneratedClip` rows.
- **Idempotency**: each render job's output path is deterministic
  (`{jobId}/clips/{clipCandidateId}.mp4`); a retried render job overwrites
  the same path rather than accumulating orphaned files.
- **Failure**: per-clip — one clip failing to render does not fail the
  whole job. The parent `RENDERING_CLIPS` stage waits for all sub-jobs;
  moves to `CLIPS_RENDERED` once all sub-jobs reach a terminal state
  (success or failed), with a partial-success flag if some clips failed.
  Whole-stage failure only if *zero* clips render successfully and there
  were candidates to render.

### 3.9 GENERATING_CONTENT → CONTENT_GENERATED
- `content.generate` job — fanned out per content type (blog, LinkedIn,
  X/Twitter, Instagram caption, YouTube description), each an independent
  `AIProvider.generateSocialContent()` / `generateText()` call against a
  type-specific prompt template and output schema. Runs in parallel with
  clip rendering (3.8) where possible — content generation does not
  depend on rendered clips, only on the transcript/analysis — which is
  why the DAG in `docs/QUEUE.md` shows these as siblings, not sequential.
- **Failure**: per-content-type, same partial-success pattern as clips.

### 3.10 FINALIZING → COMPLETED
- Deterministic aggregation step: computes overall job success/partial-
  success status, updates `Project` summary counters, records final usage
  against the user's quota (see `docs/COST.md`), emits a "processing
  complete" notification hook (email/in-app — in-app only for V1).
- **Failure**: retryable (should essentially never fail — it's bookkeeping)
  but if it does, does not roll back already-completed clip/content work;
  logged and retried independently of the upstream stages.

## 4. Retry & backoff policy (summary — full detail in `docs/QUEUE.md`)

| Failure class                          | Retryable? | Backoff              |
|------------------------------------------|------------|------------------------|
| Deterministic validation failure           | No          | —                        |
| Transient infra (network, worker crash)      | Yes         | Exponential, capped     |
| External AI/transcription API error (5xx/timeout) | Yes    | Exponential, capped      |
| External API quota/limit exceeded            | No          | — (surfaced immediately) |
| Deterministic code bug (scoring, aggregation)  | Once (defensive) | Fixed short delay  |

## 5. Idempotency strategy (summary)

Every job payload carries the `processingJobId` plus a stage-appropriate
natural key (`mediaAssetId`+checksum for transcription, `clipCandidateId`
for rendering, `contentType` for generation). Before doing paid/expensive
work, every processor checks whether a result already exists for that key
and short-circuits if so. This makes the whole pipeline safe to retry at
any stage without duplicating cost or output — critical given transcription
and AI generation are the stages with real dollar cost per retry.

## 6. Cancellation
A user-initiated `CANCELLED` transition is allowed from any non-terminal
state. The API sets the flag; in-flight worker jobs check a
`isCancelled(jobId)` guard at the start of each processor (and between
fan-out sub-jobs) and exit early without persisting further paid-API
results. Already-completed sub-results (e.g. clips already rendered before
cancellation) are kept, not deleted, so the user isn't penalized for
partial work already paid for.
