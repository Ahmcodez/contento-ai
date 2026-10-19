# Contento AI — Project Handoff Summary (v5)

Continuing work in a new chat. Read fully before changing anything; it reflects the real, tested state. This supersedes the earlier versions. Don't re-architect casually, and re-read "Everything fixed" before touching an area so a request to "improve X" isn't redone or doesn't contradict a recent fix.

## Repo and workflow
- GitHub: `https://github.com/Ahmcodez/contento-ai` (private). Git identity: `user.email "muhammad234204@gmail.com"`, `user.name "ahmcodez"`.
- The person provides a fresh PAT at the start of a session. Treat any pasted PAT as compromised and rotate it afterwards. Keep it out of `.git/config` (push with a one-off authenticated URL).
- Small, human-named commits, one logical change each, **pushed as each chunk is done, never batched at the end**.
- Layout: `/backend`, `/frontend`, `/docs` (architecture, ADRs, ops), `docker-compose.yml`.

## What this is
AI-powered content repurposing SaaS. Upload a long video or paste a URL, and one async pipeline transcribes it, finds/scores/renders short vertical captioned clips, and writes grounded blog/LinkedIn/X/Instagram/YouTube copy.

## Stack
- **Backend**: Node.js, Express, plain JavaScript (CommonJS), Knex, PostgreSQL, Redis + BullMQ with **5 physical queues** (`pipeline-light`, `ai-process`, `url-import-download`, `transcription-process`, `clip-render`) carrying 10 logical stages (`docs/QUEUE.md`).
- **Frontend**: Next.js 16 / React 19 + Tailwind. **Untouched in the last several sessions.**
- **AI**: Gemini (`gemini-3.6-flash`, automatic one-hop fallback to `gemini-3.5-flash-lite` on daily quota or 503). Verify any new model name by search; never guess a naming pattern.
- **Transcription**: `whisper-local` and `groq` (hosted, recommended); both return word-level timestamps.
- **URL import**: provider registry + `yt-dlp` (`docs/URL_IMPORT.md`).
- All ADRs are in `docs/adr/`.

## Everything fixed or built (chronological, all pushed)
**Earlier sessions**: Redis idle traffic cut ~88% and 10 queues consolidated to 5; yt-dlp ffmpeg-path resolution; yt-dlp huge-metadata buffer; proactive Gemini rate limiter; `RetryInfo.retryDelay` honored; fail-fast on daily quota; automatic model fallback; FFmpeg `veryfast`/CRF 23 (47% faster) and bounded per-job render concurrency; required, quality-scored `hook`; story/quote data fed into clip detection; word-level captions grouped into ~4-word cues (and the dropped-`word_timestamps` bug); 4-hour max video length.

**This session**
- **Re-run safety.** Transcript, content analysis and clip-candidate persistence now replace instead of colliding on unique keys or stacking duplicates, so a stage can safely run twice (this was also a latent bug for BullMQ retries).
- **Stuck-job reaper** (`src/workers/stuckJobReaper.js`, `docs/STUCK_JOB_REAPER.md`). Recovers rows whose Postgres state is in progress but that have no live queue job (crash between state change and enqueue, Redis flush, job BullMQ failed as stalled). Postgres-first, so Redis is untouched when nothing is stuck. Re-enqueues up to `REAPER_MAX_REQUEUES_PER_STAGE` per state, then fails with a clear message. Never acts if Redis can't be read. Redis lock plus atomic row claim for multi-process safety. Runs inside the worker (`REAPER_ENABLED`); `npm run reap` for a manual sweep. Shared helpers live in `src/queue/stageResume.js`.
- **`POST /jobs/:id/retry`** resumes a FAILED job from the stage it failed in (read from its last FAILED event). Refuses non-failed jobs, media rejected at validation (so retry can't bypass duration/audio/quota checks) and unknown failing stages; respects the concurrent-job limit; guarded in the DB so a double click retries once; gives the reaper a fresh allowance.
- Dockerfile now installs the standalone `yt-dlp` binary (x86/ARM) and checks `--version` at build time. **Not live-built: no Docker daemon here.**
- Admin key compared in constant time.
- Docs: `STUCK_JOB_REAPER.md`, `URL_IMPORT.md` (new); `ARCHITECTURE.md` status corrected with a "where it differs" section; `SECURITY.md` gained URL-import/SSRF and admin-key sections; a false claim about idempotency keys was removed.
- Tests/lint: lint is fully clean (0 errors, 0 warnings). Test-suite hygiene fixed: the AI rate-limit counter leaking between worker-based e2e files (it caused order-dependent failures), and four files leaking Redis/queue connections so Jest now exits cleanly.

## Verification standard — keep this up
Every fix: (1) reproduce with a real test first (real Postgres/Redis/BullMQ/ffmpeg; fake local HTTP servers replaying real error bodies for network APIs), (2) fix, (3) prove with a live run, (4) add tests, (5) full suite + lint clean, (6) small commit, (7) push. **Current: 58 suites, 619 tests, all passing, 0 lint warnings.** A plausible fix that isn't run against real data has repeatedly had bugs here (ffmpeg path, model names, the caption drop-bug, and `obliterate()` not clearing the limiter key). Unit tests alone miss bugs that cross files; keep doing live e2e runs.

## Known gaps — still true
- **Frontend navbar/page-layout audit** was requested and never started. Pre-login navbar should match the landing page, not show internal links; page layouts feel "congested"; audit page by page.
- **Unverified at scale**: cost and viral-clip claims have only run against fake servers; no real multi-hour podcast with real Gemini/Groq keys has been run (sandbox has no real network to them).
- Docker compose and the new Dockerfile have never been run on a real Docker daemon.
- No password reset (needs email infrastructure), no manual clip editing/re-render, no content export-as-file.
- Karaoke-style per-word caption highlighting not built (current output is correctly timed 4-word chunks).
- SEO landing pages for URL import, never built (low priority).
- Known flake: `redisResilience` can fail under `jest --detectOpenHandles` (also on the original code); never in normal runs.

## What's next
1. Frontend navbar/layout audit (user is waiting on this).
2. Real-key run on a multi-hour podcast; verify Docker end to end.
3. Password reset (decide an email provider first), manual clip editing, content export.
4. Optional: karaoke caption highlighting.

## Operational notes for a fresh sandbox
- Start services: `pg_ctlcluster 16 main start`; `redis-server --daemonize yes --save "" --appendonly no --dir /tmp --logfile /tmp/redis.log`. Background processes do **not** survive between tool calls; services may need restarting each time.
- Need the `contento` Postgres role (superuser) and `contento_dev` / `contento_test` databases; run `npx knex migrate:latest` for both (`--env test` for the test DB). `apt-get install ffmpeg postgresql redis-server`; `pip install --break-system-packages yt-dlp`.
- Tests use `contento_test` and **Redis DB 1**. `resetDb()` wipes Postgres only; stale queue state in Redis DB 1 causes confusing flakes (`redis-cli -n 1 flushdb`).
- Run the full suite **detached** (it takes ~2.5 minutes, past the 5-minute command limit once the output is piped): `setsid nohup npm test > /tmp/test.log 2>&1 < /dev/null &`, then poll the log.
- Real network to YouTube/Groq/Gemini is blocked by sandbox egress. GitHub and package registries work.
