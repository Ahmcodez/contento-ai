# Contento AI — Project Handoff Summary

Continuing work on this project in a new chat. Read this fully before making changes — it reflects the real, tested current state, not just the plan. Do not re-architect or "improve" things casually; ask or check before deviating from established patterns below.

## Repo
- GitHub: `https://github.com/Ahmcodez/contento-ai` (private)
- Git identity to use for all commits: `user.email "muhammad234204@gmail.com"`, `user.name "ahmcodez"` — set this before any commit in a fresh environment.
- 149 commits so far, all small and human-named (e.g. "fix cors allowlist", "add clip scoring tests") — never large AI-style commit messages, never batch everything into one commit. Commit and push after each real chunk of work, incrementally, not at the end of a session.
- Structure: `/backend`, `/frontend`, `/docs` (architecture + ADRs), `docker-compose.yml` at root.

## What this product is
AI-powered content repurposing SaaS. Upload a long-form video → async pipeline transcribes it, analyzes it, finds/scores/renders short vertical clips with captions, and writes grounded blog/LinkedIn/X/Instagram/YouTube copy from the same source. V1 explicitly excludes: URL ingestion, B-roll, social publishing, payments.

## Stack (deviations from typical defaults, and why)
- **Backend**: Node.js, Express, plain JavaScript (no TypeScript), Knex (not Prisma — Prisma's engine binaries aren't reachable from this sandbox's network allowlist; see ADR-009).
- **DB**: PostgreSQL. **Redis**: BullMQ + rate limiting.
- **Frontend**: Next.js (App Router) + Tailwind, plain JS. Fonts are self-hosted via `@fontsource` packages, not `next/font/google` (same network-sandbox reachability issue; see ADR-010).
- **Storage**: `StorageDriver` abstraction — `LocalDiskStorageDriver` (dev default) and a real `S3StorageDriver` (S3-compatible: AWS/B2/R2/MinIO; see ADR-011).
- **AI**: `AIProvider` abstraction, Gemini adapter implemented for real (HTTP, no SDK dependency). No API key is configured anywhere — `AI_PROVIDER=none` by default, and every AI-dependent stage fails **cleanly and honestly** with a clear "not configured" error rather than faking output. This is intentional, not a bug.
- **Transcription**: same pattern — `TranscriptionProvider` abstraction, local Whisper CLI adapter, `TRANSCRIPTION_PROVIDER=none` by default.
- All 11 ADRs are in `docs/adr/` — read them before questioning a design choice, the reasoning is documented there.

## Design system (frontend)
Dark neutral palette (`ink`/`paper`/`slate`/`line`), one restrained accent color `tally` (a muted broadcast-tally-light red — not purple/neon, deliberately avoiding generic-AI-SaaS look). Type pairing: Fraunces (display/headlines only), Public Sans (UI/body), IBM Plex Mono (timecodes/durations/scores — real NLE vernacular). Signature recurring motif: a literal timecode ruler (`TimelineRuler` component), used in the landing hero and the processing pipeline visual instead of generic numbered-circle steps.

## Current feature state — backend
Fully implemented, tested, working against real Postgres/Redis/FFmpeg (not mocked, except the AI provider network boundary which has no credentials):
- Auth: register/login/refresh (rotating)/logout, argon2/bcrypt hashing, JWT (HS256 pinned explicitly).
- Projects: full CRUD, workspace-based ownership, 404-not-403 on unauthorized access.
- Upload: real magic-byte MIME sniffing, checksum dedup, safe opaque storage keys, size/duration limits.
- Full processing pipeline, every stage real and working: `UPLOADING → VALIDATING → VALIDATED → EXTRACTING_AUDIO → AUDIO_EXTRACTED → TRANSCRIBING → TRANSCRIBED → ANALYZING → ANALYZED → FINDING_CLIPS → CLIPS_FOUND → CLIPS_SCORED → RENDERING_CLIPS → CLIPS_RENDERED → GENERATING_CONTENT → CONTENT_GENERATED → COMPLETED`. Verified end-to-end via a real e2e test that mocks only the AI/transcription network call.
- Clip detection: AI proposes candidates, deterministic code clamps/merges/scores them (`src/clips/candidates.js`, `src/clips/scoring.js`) — AI output is never trusted directly.
- Clip rendering: real FFmpeg 9:16 crop, burned-in captions (SRT generation with line wrapping), thumbnail generation, output validation (re-probes the rendered file, doesn't trust ffmpeg's exit code alone).
- Written content: 5 platforms, grounded-in-transcript prompting, hard character-limit enforcement for X/Twitter.
- AI reliability: retry+backoff, zod schema validation, markdown-fence JSON recovery, usage tracking, and a **real enforced** per-job AI call budget (not just tracked).
- Full REST API surface: auth, projects, media, jobs (status/events/cancel/transcript/clips/content), clip download, content edit/regenerate, usage summary.
- Cost controls: all the `MAX_*` env vars are real and enforced (upload size/duration, clips per video, AI requests per day, concurrent jobs, **projects per user**, **processing minutes per month** — the last two were found missing and added during the infra pass).
- DB: indexes/constraints/cascades reviewed and hardened (fixed a real FK cascade bug where `usage_records` blocked deletion of jobs it referenced). Cleanup script for expired tokens + orphaned temp files.
- Observability: structured logging (requestId, userId, jobId, stage, duration — no secrets, redaction verified live), lightweight in-process metrics (`/metrics`), `/health/ready` (real DB+Redis check).
- **189 backend tests, all passing.** Run with `cd backend && npx jest --runInBand` (needs Postgres + Redis running — `service postgresql start && service redis-server start` in this sandbox).

## Current feature state — frontend
All 9 core screens built and working against the real API (no fabricated endpoints — where the frontend needed backend data that didn't exist yet, real backend endpoints were added first, with tests):
- Landing page, login/signup/forgot-password (forgot-password honestly states self-service reset isn't available — no backend endpoint for it).
- Dashboard (real project list with live status), create-project + upload (drag/drop, real progress via XHR, cancel/retry).
- Processing screen (pipeline timeline visual, live polling per ADR-008 — polling, not WebSockets), project workspace, clips grid (real download), content tabs (edit/copy/regenerate against real endpoints), usage page.
- Honestly surfaced (not faked) missing capabilities: job retry, manual clip re-render/bound-editing, content export-as-file (copy-to-clipboard is the real substitute) — all documented inline in `frontend/src/lib/api/*.js`.
- `next build` passes clean on all routes.

## Infrastructure state
- `docker-compose.yml`: Postgres, Redis, backend, worker (shared image, FFmpeg installed, shared storage volume). **Caveat: not live-tested** — no Docker daemon available in this sandbox, and Docker Hub isn't in the sandbox's network allowlist either. YAML syntax validated, logic reviewed carefully, but a real `docker compose up` verification has never actually run. Do this on first use in a new environment.
- Docs: `docs/CONFIGURATION.md` (dev/test/prod env separation), `docs/DEPLOYMENT.md` (Docker + production architecture + specific free/low-cost provider recommendations: Fly.io/Railway, Neon/Supabase, Upstash, Backblaze B2/Cloudflare R2, Vercel), `docs/BACKUP.md` (backup/recovery strategy, including why Redis needs none).

## Known, deliberate, documented gaps (not oversights — don't "fix" without discussion)
- No job retry endpoint, no manual clip editing/re-render endpoint, no content export-as-file endpoint.
- No password reset flow.
- Clip candidate scoring is a heuristic + AI blend, explicitly never described as a virality guarantee.
- No automated "stuck job" reaper if a worker crashes mid-job.
- Docker compose unverified live (see above).
- Log context has `userId`/`jobId`/`stage`/`requestId` but not `projectId` explicitly.

## Sandbox-specific operational notes (only relevant if working in a similar sandboxed environment)
- Postgres/Redis/FFmpeg installed via apt in this sandbox; services do **not** persist across environment resets — always run `service postgresql start && service redis-server start` at the start of a session before anything DB-related.
- Background processes (long-running servers) do **not** survive between separate tool calls in this sandbox — any live smoke-test of the running app must start the server/worker AND run the test commands within the *same* tool call/script.
- Network egress is allowlisted to package registries (npm, pypi, github), not arbitrary CDNs — this is why Prisma (binary CDN) and `next/font/google` (Google Fonts CDN) had to be swapped for alternatives (Knex, `@fontsource`). Keep this in mind before adding any dependency that fetches binaries/assets from a non-registry domain at install/build time.
- Test DB (`contento_test`) and dev DB (`contento_dev`) are separate; Redis test/dev also separated via DB index. Test env vars are force-set in `backend/test/env.js` before any module loads, so `.env` can never leak into a test run.

## What's next (not yet done — for production readiness)
This was explicitly not finished in this chat; pick up here:
1. **Verify Docker compose live** — actually run `docker compose up` end to end somewhere with a real Docker daemon, confirm upload → worker processes it → clip renders, fix whatever breaks.
2. **Real AI/transcription credentials** — currently everything downstream of transcription has only ever been tested with a mocked provider boundary. Get a real Gemini API key and either a hosted STT provider or a working local Whisper install, and do a real end-to-end run with real output quality review.
3. **Job retry, manual clip editing, content export** — the three most requested-feeling missing capabilities; decide which to build first.
4. **Password reset flow.**
5. **Production deployment** — actually stand up the recommended stack (Fly.io/Railway + Neon/Supabase + Upstash + R2/B2 + Vercel) rather than just documenting it.
6. **Responsive/mobile pass on the frontend** — built desktop-first per the brief, mobile hasn't been specifically audited.
7. **Stuck-job detection/recovery** — no reaper exists yet for a worker crash mid-job.
8. **General production hardening pass** — rate limit tuning under real load, review whether the current in-process metrics module is sufficient or whether a real APM/error-tracking service (e.g. Sentry) is worth adding once there's real traffic to justify it.

When resuming: state clearly which of the above (or something else) you want worked on next. Do not assume features not listed as "done" above exist.
