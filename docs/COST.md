# Cost Architecture

## 1. What runs entirely free/local in dev

| Component | Dev/test choice | Cost |
|---|---|---|
| Postgres | Docker container (local) or free tier (Supabase/Neon) | $0 |
| Redis | Docker container (local) or free tier (Upstash) | $0 |
| Object storage | Local disk (`LocalDiskStorageDriver`) | $0 |
| FFmpeg | Local binary | $0 |
| Transcription | Self-hosted Whisper (`whisper.cpp`/faster-whisper) available as a provider, off by default (`TRANSCRIPTION_PROVIDER=none`) — a fresh clone with zero config makes zero transcription calls of any kind, not even a free local one | $0 |
| Queue infra | BullMQ on the local/free Redis | $0 |
| Monitoring | `GET /api/v1/admin/queues` (real BullMQ job counts per queue, gated by `ADMIN_API_KEY`) + local structured logs | $0 |
| CI | GitHub Actions (free tier for private repos at this scale) | $0 |

## 2. What has real, per-call cost — and is therefore gated

| Operation | Cost driver | Guardrail |
|---|---|---|
| Transcription (if using a hosted API instead of local Whisper) | Per-minute of audio | `MAX_VIDEO_DURATION_SECONDS`, per-user daily quota, idempotency (never re-transcribe the same asset) |
| `content.analyze` (Gemini calls) | Per-token | The only full pass over the transcript besides content generation. One call per ~30k-character chunk (`MAX_TRANSCRIPT_CHARS_PER_AI_CALL`, `MAX_TRANSCRIPT_CHUNKS`), sequential, each at most 5 items per category. It also proposes the clips, so there is no separate detection pass. |
| `clips.detect` | **No AI call normally** | Turns the analysis' clip proposals into exact clips in code. Only if analysis left no proposals does it fall back to asking the model (one call per chunk). |
| `content.generate` (Gemini, **1 call** for all 5 content types) | Per-token | The transcript is sent once, not once per type. Falls back to one call per type only if the combined answer can't be validated. Quota-gated per regenerate action too. |
| `clip.render` (FFmpeg, CPU/time not $, but compute time = infra cost at scale) | Compute minutes | `MAX_CLIPS_PER_VIDEO`, bounded clip duration |

### Where the transcript goes

A video's transcript is now sent to the model **twice** (analysis, content generation).
It used to be sent about **seven** times: analysis, a separate clip-detection pass, and
once for each of the five content types. A test (`test/contentBundle.test.js`) pins the
content-generation half of that: five separate prompts carry more than 4x the text of
the one combined prompt. Typical AI calls per video: ~5 to 6 (it was up to 14), which
also stretches the per-user daily AI limit and any provider free tier that counts requests.

Line numbering adds a short id to each line and a time marker once a minute, about 3% on
top of the transcript, and replaces boundaries the model used to guess.

Transcription (Groq / local Whisper) is billed by audio duration, not tokens. Audio is
already extracted at 16 kHz mono (the minimum the speech model needs), transcribed once,
and a retry reuses the stored transcript rather than transcribing again.

Every row in the right column above is an actual configurable value in
`.env.example` / the `quotas` table (`docs/DATABASE.md`) — nothing is a
hardcoded constant buried in code.

## 3. Usage-quota system design

- **Ledger, not counter**: `usage_records` is append-only (see
  `docs/DATABASE.md`). A quota check is: `SUM(amount) WHERE user_id=? AND
  category=? AND occurred_on >= <window start>` compared against the
  `quotas` row for the user's `plan`. This avoids counter-drift bugs and
  makes usage independently auditable/correctable.
- **Enforcement point**: quota checks happen in the **API layer**, before
  a job is enqueued — never after the fact. A request that would exceed
  quota gets `429 QUOTA_EXCEEDED` with the specific limit in the body
  (`docs/API.md`), so the frontend can show an accurate, specific message
  rather than a generic failure.
- **Defense in depth**: the worker *also* re-checks quota immediately
  before making a paid AI/transcription call (not just relying on the
  API-layer check), because a job could sit in the queue for a while
  between enqueue and execution during which the user's usage picture
  could change (e.g. concurrent requests). Belt-and-suspenders, cheap to
  implement, prevents a real class of race-condition overspend.
- **Daily/monthly rollups**: for scale (§ `docs/SCALABILITY.md`), a
  materialized daily rollup table can be added later so quota checks don't
  scan the full ledger — not needed at V1 volumes, explicitly deferred.

## 4. Preventing accidental API bills

- **Fail-fast config validation at boot**: if `AI_PROVIDER=gemini` but
  `GEMINI_API_KEY` is unset, the app refuses to start rather than silently
  failing (and definitely never falls back to "just try the call and see")
  on every request.
- **Hard ceiling env vars, not just per-user quotas**: `MAX_AI_REQUESTS_PER_USER_PER_DAY`
  caps a single user (actually enforced in `reliableCall.js`, checked before
  every AI call — see `docs/RELEASE_READINESS.md` for why this is worth
  calling out explicitly). `MAX_TOTAL_AI_REQUESTS_PER_DAY` is a global,
  account-wide ceiling across every user combined — 0 (unset) disables it,
  intended for a small shared dev/staging environment or as an emergency
  brake rather than a normal production setting. Cheap insurance against a
  runaway retry loop bug burning through a budget overnight.
- **Local-first default provider for transcription**: `TRANSCRIPTION_PROVIDER`
  defaults to `none` (not self-hosted Whisper) — a fresh clone with zero
  configuration makes no transcription calls at all, paid or free-but-slow.
  Self-hosted Whisper is available and genuinely free per-call, but is an
  explicit opt-in via config, not a silent default.
- **Idempotency everywhere a paid call happens** (`docs/PIPELINE.md` §5,
  `docs/QUEUE.md` §6) means retries — the most common source of
  "accidentally called the API 5 times for one job" — reuse prior results
  instead of re-spending.
- **Queue visibility**: `GET /api/v1/admin/queues` (gated by `ADMIN_API_KEY`)
  surfaces real per-queue job counts (waiting/active/failed/delayed), so a
  runaway job (e.g. an infinite retry loop from a misconfigured backoff) is
  visible without shelling into Redis or the database directly, rather
  than discovered via a bill at month's end. A fuller dashboard UI (e.g.
  Bull Board) remains a reasonable future addition — not built yet, see
  `docs/RELEASE_READINESS.md`.

## 5. Cost-aware defaults, summarized

```
MAX_UPLOAD_SIZE_MB=500
MAX_VIDEO_DURATION_SECONDS=3600          # 60 min free-tier ceiling
MAX_CLIPS_PER_VIDEO=10
MAX_AI_REQUESTS_PER_USER_PER_DAY=50
MAX_PROCESSING_JOBS_PER_USER_CONCURRENT=2
```
All from `.env.example`, already committed — these are starting points,
tunable per environment without a code change.
