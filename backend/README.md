# Contento AI — Backend

Node.js / Express API + BullMQ workers for the video repurposing pipeline.
See `/docs` at the repo root for the full architecture, database, and API
design this implementation follows.

## Stack

- Node.js, Express (plain JavaScript, no TypeScript build step)
- PostgreSQL via Knex (query builder + migrations — see
  `docs/adr/009-knex-over-prisma.md` for why Knex instead of Prisma)
- Redis + BullMQ for the job queue
- FFmpeg for video/audio processing
- Jest + Supertest for tests

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 6+
- FFmpeg (`ffmpeg` and `ffprobe` on your `PATH`)

On Debian/Ubuntu:
```bash
sudo apt-get update
sudo apt-get install -y postgresql redis-server ffmpeg
```

## Setup

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Copy the env file and fill in real local values (never commit `.env`):
   ```bash
   cp .env.example .env
   ```
   At minimum, set real random strings for `JWT_ACCESS_SECRET` and
   `JWT_REFRESH_SECRET` (32+ characters each). Everything else has a
   sensible local default.

3. Create the database and user (adjust to your local Postgres setup):
   ```bash
   sudo -u postgres psql -c "CREATE USER contento WITH PASSWORD 'contento' SUPERUSER;"
   sudo -u postgres psql -c "CREATE DATABASE contento_dev OWNER contento;"
   sudo -u postgres psql -c "CREATE DATABASE contento_test OWNER contento;"
   ```
   `contento_test` is used by the test suite (`test/globalSetup.js` runs
   migrations against it automatically — you don't need to migrate it
   yourself).

4. Make sure Postgres and Redis are running:
   ```bash
   sudo service postgresql start
   sudo service redis-server start
   ```

5. Run migrations against the dev database:
   ```bash
   npx knex migrate:latest
   ```

## Running

Start the API:
```bash
npm run dev
```
The API listens on `PORT` (default `4000`). Check it's up:
```bash
curl http://localhost:4000/health
```

Start the worker (separate process — handles the async processing
pipeline: `video.validate`, `audio.extract`, `transcription.process`,
`content.analyze`, `clips.detect`):
```bash
npm run worker
```

Both must be running for an uploaded video to actually get processed —
the API only ever enqueues the first job (`video.validate`); everything
after that is driven by the worker.

## AI / transcription providers

By default `AI_PROVIDER=none` and `TRANSCRIPTION_PROVIDER=none` — the
pipeline runs for real through validation, audio extraction, and correctly
fails with a clear "not configured" error at the transcription stage
rather than faking output. This is intentional (see
`docs/adr/006-ai-provider-abstraction.md` and `docs/AI.md` §"AI proposes,
code disposes").

To enable transcription for free, install a local Whisper CLI on your
`PATH` and set:
```
TRANSCRIPTION_PROVIDER=whisper-local
```

To enable AI analysis/clip detection/content generation, get a Gemini API
key and set:
```
AI_PROVIDER=gemini
GEMINI_API_KEY=your-real-key
```

## Tests

```bash
npm test
```
Tests run against `contento_test` (migrated automatically) and a separate
Redis logical DB (`REDIS_URL_TEST`, defaults to `redis://localhost:6379/1`)
so they never touch your dev data. Postgres and Redis must be running
first.

## Project layout

```
src/
  config/        env loading + validation (fails fast on boot if misconfigured)
  logger/        structured logging with secret redaction
  db/            Knex client
  redis/         Redis client (shared by BullMQ and rate limiting)
  routes/        thin Express route definitions
  controllers/   HTTP <-> service translation
  services/      business logic (auth, projects, media, jobs, quota)
  repositories/  the only layer that queries the database
  middleware/    auth, validation, rate limiting, error handling, upload
  validation/    zod request schemas
  storage/       StorageDriver abstraction (local disk in dev)
  media/         FFmpeg wrapper (safe argument construction, no shell)
  ai/            AIProvider abstraction + Gemini adapter
  transcription/ TranscriptionProvider abstraction + local Whisper adapter
  queue/         BullMQ queue definitions and job producers
  workers/       BullMQ job processors (the pipeline)
  app.js         Express app assembly
  server.js      API process entrypoint
  worker.js      worker process entrypoint
migrations/      Knex SQL migrations
test/            Jest + Supertest test suite
```

## What's implemented vs. deferred

Implemented and tested end-to-end against a real database, Redis, and
FFmpeg: auth, project ownership, video upload with real content
validation, the queue-driven processing pipeline through
`video.validate` → `audio.extract` → `transcription.process` →
`content.analyze` → `clips.detect`, job status/cancel, and centralized
error handling.

Deferred to a later milestone (see `docs/SUMMARY.md`): persisting
transcripts/clip candidates/generated content to their own tables, clip
scoring and rendering, and the content-generation fan-out. Those
processors aren't stubbed with fake data — they're simply not built yet,
since their schema doesn't exist yet either.
