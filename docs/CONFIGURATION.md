# Configuration

All runtime configuration is environment variables, loaded once at boot
into a single validated, typed object (`backend/src/config/index.js`,
built on `zod`). No other file reads `process.env` directly — every value
the app needs comes from `require('../config')`. If a required variable
is missing or malformed, **the process refuses to start** and prints
exactly which variable is wrong, rather than failing confusingly on the
first request that needs it. This is deliberate — see
`docs/COST.md` §4 and `docs/adr/*` for the specific cases (AI provider,
S3 storage, JWT secrets) where this has already caught a real
misconfiguration during development of this project.

## Environment separation

Controlled entirely by `NODE_ENV`, which the config module reads and
exposes as `config.env` / `config.isProduction` / `config.isTest`:

| | `development` | `test` | `production` |
|---|---|---|---|
| Set by | `.env` (`NODE_ENV=development`, the default) | `test/env.js`, loaded before every Jest run — **not** `.env` | deployment platform env vars |
| Database | `contento_dev` (local/managed) | `contento_test` (auto-migrated by `test/globalSetup.js`) | managed Postgres, own database |
| Redis | local/managed, DB 0 | local/managed, **DB 1** (`REDIS_URL_TEST`, isolated from dev queue/rate-limit state) | managed Redis |
| Storage | local disk by default | local disk, separate `storage/test-uploads` / `storage/test-tmp` paths | S3-compatible (see below) |
| Rate limits | real limits from `.env` | relaxed (1000/window) — see `test/env.js` — so tests aren't flaky against real limits | real limits, tuned for the deployment |
| Logging | `pino-pretty`-free JSON (see `src/logger`) | silent (`level: 'silent'`) | JSON, ship to a log aggregator |
| AI/transcription | off unless explicitly configured (see `docs/AI.md`) | always off — tests mock the provider boundary, never hit a real API | configured with real keys |

**Test isolation is structural, not just configured**: `test/env.js` sets
`process.env` values directly before any application module loads (via
Jest's `setupFiles`, which runs before `setupFilesAfterEnv` and before
test files), and `dotenv.config()` in `src/config/index.js` never
overwrites an already-set variable — so `.env` cannot leak into a test
run even if both files define the same key.

## Full variable reference

See `backend/.env.example` for the authoritative, always-up-to-date list
with defaults — this table explains *why* each group exists rather than
duplicating values that will drift.

| Group | Variables | Purpose |
|---|---|---|
| App | `NODE_ENV`, `PORT`, `CORS_ORIGINS` | Basic process/network config. `CORS_ORIGINS` is a real allowlist, not a wildcard — see `docs/adr` on the CORS fix. |
| Database | `DATABASE_URL` | Single connection string, Knex-compatible (`postgres://user:pass@host:port/db`). |
| Redis | `REDIS_URL` | Shared by BullMQ and the rate limiter (`docs/ARCHITECTURE.md` §2.6). |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN_DAYS` | Both secrets must be ≥16 chars (enforced) — generate real random values, never reuse the example. |
| AI provider | `AI_PROVIDER`, `GEMINI_API_KEY` | `AI_PROVIDER=none` (default) means AI-dependent pipeline stages fail cleanly with a clear message rather than fabricating output — see `docs/AI.md`. |
| Transcription | `TRANSCRIPTION_PROVIDER` | Same pattern — `none` by default, `whisper-local` for zero-cost local transcription. |
| Storage | `STORAGE_DRIVER`, `STORAGE_LOCAL_PATH`, `STORAGE_TMP_PATH`, `S3_*` | `local` by default (free, zero setup). `s3` works with AWS S3 or any S3-compatible provider (B2/R2/MinIO) — see `docs/adr/011-s3-storage-driver.md`. Fails fast at boot if `s3` is chosen without `S3_BUCKET`. |
| Cost limits | `MAX_UPLOAD_SIZE_MB`, `MAX_VIDEO_DURATION_SECONDS`, `MAX_CLIPS_PER_VIDEO`, `MAX_AI_REQUESTS_PER_USER_PER_DAY`, `MAX_PROCESSING_JOBS_PER_USER_CONCURRENT`, `MAX_PROJECTS_PER_USER`, `MAX_PROCESSING_MINUTES_PER_USER_PER_MONTH`, `MAX_TRANSCRIPT_CHARS_PER_AI_CALL`, `MAX_TRANSCRIPT_CHUNKS`, `MAX_AI_CALLS_PER_JOB`, `MAX_GENERATED_CONTENT_TYPES`, `AI_RETRY_ATTEMPTS` | Every one of these is a real, enforced guardrail, not a suggestion — see `docs/COST.md` for what each protects against and where in the code it's checked. |
| Clip tuning | `CLIP_MIN_DURATION_SECONDS`, `CLIP_MAX_DURATION_SECONDS` | Feed the deterministic clip-scoring model (`src/clips/scoring.js`), not just a validation bound. |
| Captions | `CAPTION_FONT`, `CAPTION_FONT_SIZE`, `CAPTION_MAX_CHARS_PER_LINE`, `CAPTION_MAX_LINES`, `CAPTION_SAFE_MARGIN_PERCENT` | Style knobs for the caption generator (`src/media/CaptionGenerator.js`) — the seam for supporting multiple visual styles later. |
| Rate limiting | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `AUTH_RATE_LIMIT_MAX_REQUESTS` | Redis-backed sliding window (`docs/SECURITY.md` §5); auth endpoints get a stricter limit. |
| FFmpeg | `FFMPEG_PATH`, `FFPROBE_PATH`, `FFMPEG_OUTPUT_MAX_SIZE_MB` | Override if the binaries aren't on `PATH`; the size ceiling guards against a runaway/corrupt render. |
| Queue | `QUEUE_CONCURRENCY_DEFAULT`, `QUEUE_CONCURRENCY_TRANSCRIPTION` | Per-queue worker concurrency (`docs/QUEUE.md` §5) — transcription defaults lower since it's the stage most likely to be rate-limited by an external provider. |

## Frontend

The frontend has exactly one runtime variable:
`NEXT_PUBLIC_API_URL` (see `frontend/.env.example`), pointing at the
backend's base URL. Everything else is compiled in at build time (Next.js
static/SSR build), so there is no separate frontend "environment config"
system to document — it's one value.

## Adding a new configuration value

1. Add it to the `zod` schema in `backend/src/config/index.js` with a
   sensible default where one makes sense (never a default for a secret).
2. Expose it under the right nested group in the object `loadConfig()`
   returns — don't add a new top-level key for something that belongs
   under `limits`/`storage`/etc.
3. Add it to `backend/.env.example` with a one-line comment explaining
   what it controls, in the same section as related variables.
4. If it changes behavior in a way another engineer would need to know
   about (a new cost limit, a new fail-fast check), note it in this file
   or `docs/COST.md`, not just the code comment.
