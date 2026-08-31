# Production Readiness Review

Principal Engineer pass, assuming eventual use by thousands of users.
Findings below are all grounded in the actual repository as of this
review — file/line references, real query plans, and a live web search
confirming current third-party model/pricing status, not assumptions.
Where a claim needed verification (dependency vulnerabilities, current
Gemini model availability, index coverage) it was checked directly
rather than asserted.

**Full verification after fixes**: backend suite 264/264 passing, backend
lint 0 errors, frontend lint/build clean, migrations run clean from a
dropped-and-recreated database, and the backend, worker, and frontend
were each started as real processes and exercised with real HTTP
requests (register → JWT issued → authenticated project creation;
worker attached to all 8 queues; frontend served a 200 on `/`) — not
just "the build passed."

---

## 1. Critical problems

### 1.1 The AI pipeline was completely non-functional against the real Gemini API — FIXED
`GeminiProvider.js` hardcoded `model = 'gemini-1.5-flash'`. A live web
search confirmed **Gemini 1.5 models are fully shut down** — every real
call would 404. This wasn't "using an outdated model," it was a dead
code path: with a real `GEMINI_API_KEY` configured, `content.analyze`,
`clips.detect`, and `content.generate` would fail on every single job,
100% of the time.

**Fix**: `GEMINI_MODEL` is now a config-driven env var, defaulting to
`gemini-3.6-flash` (current, GA, stable as of this review, no
deprecation announced). Google retires Gemini model IDs on a roughly
3-6 month cadence — this default *will* go stale again; it's now a
config change instead of a redeploy. 11 tests, including a regression
guard against ever hardcoding a specific model id again.

---

## 2. High-priority problems

### 2.1 The documented per-user daily AI quota was never enforced — FIXED
`MAX_AI_REQUESTS_PER_USER_PER_DAY` (default 50) was defined in config
and displayed to users on the usage page (`usageView.service.js`), but
**nothing in the codebase ever checked it before making a call** — only
the separate per-job ceiling (`MAX_AI_CALLS_PER_JOB`) was enforced. A
user could exceed the documented daily limit indefinitely by starting
job after job throughout a day. This is a real, exploitable cost-control
gap, not a theoretical one.

**Fix**: `assertWithinUserDailyBudget` in `reliableCall.js`, checked
before every AI call alongside the existing per-job check. Also added
the account-wide `MAX_TOTAL_AI_REQUESTS_PER_DAY` circuit breaker that
`docs/COST.md` had been claiming existed but didn't (default 0 =
disabled). 15 tests total across both.

### 2.2 Missing index on a hot-path query column — FIXED
`processingJobRepository.countActiveForUser()` — called on **every
single upload** to enforce the concurrent-job quota — joins
`processing_jobs` to `media_assets` and filters on
`media_assets.uploaded_by`. That column had no index. At thousands of
users and a growing `media_assets` table, this is a full sequential
scan on every upload, and it gets worse over time, not just under
one-time load.

**Fix**: migration adding `CREATE INDEX CONCURRENTLY` on
`media_assets(uploaded_by)` (non-locking, safe against a live table).
Verified up/down/re-up against the real dev database.

### 2.3 No queue/job observability existed, despite docs claiming it did — FIXED
`docs/COST.md` asserted "Bull Board (self-hosted)" as an existing
monitoring component. It doesn't exist anywhere in the codebase — zero
references. At thousands of users across 8 queues, this meant no way to
answer "is anything stuck?" without direct Redis/DB access.

**Fix**: `GET /api/v1/admin/queues` — real BullMQ `getJobCounts()` per
queue, gated by an `ADMIN_API_KEY` shared secret (this app has no
admin/role concept anywhere else; building full RBAC for one endpoint
would have been real scope creep, not a right-sized fix). Unset key =
route disabled (404), never silently open. A fuller dashboard UI
remains a reasonable future addition, not built here. 4 tests.

### 2.4 FFmpeg per-invocation timeout was hardcoded — FIXED
5 minutes, baked into `MediaProcessor.js` with no way to raise it
without a code change. The comment framed it as a hung/malicious-input
guard, but it also silently caps how long a legitimately large/slow
operation can take on real (as opposed to dev-laptop) production
hardware.

**Fix**: `FFMPEG_TIMEOUT_MS` env var, same 5-minute default. 2 tests.

### 2.5 Documentation actively claimed things that weren't true
Beyond the two items above, `docs/COST.md` claimed self-hosted Whisper
was the *default* transcription provider; the real default is
`TRANSCRIPTION_PROVIDER=none`. For a document whose entire purpose is
cost-safety guarantees, false claims are worse than missing
documentation — someone could read it and skip building a safeguard
that doesn't actually exist. **Fixed**: corrected in `docs/COST.md`.

Separately, both `scripts/cleanup.js` and `src/workers/index.js`
referenced `docs/OPERATIONS.md`, which didn't exist in the repo.
**Fixed**: created it for real (cleanup schedule, logging spec, the new
admin endpoint, and the known stuck-job-reaper gap below, written up
honestly rather than silently dropped).

### 2.6 Backend had no working lint setup at all — FIXED
`package.json`'s `lint` script (`eslint src test`) had no eslint
installed or configured — it has presumably never actually run
successfully. Running it for the first time surfaced one real bug (a
`catch` block that only rethrows — harmless but dead code, cleaned up)
and a few genuinely unused variables. **Fixed**: minimal flat config
appropriate for a plain CommonJS Node app (not a larger framework
preset this codebase doesn't need). 0 errors, 21 harmless warnings
(stale `eslint-disable` comments anticipating rules this minimal config
doesn't include — cosmetic, not fixed in this pass, see §8).

---

## 3. Medium-priority improvements (not fixed this pass — recommended)

- **No stuck-job reaper.** A worker killed mid-stage (OOM, deploy,
  host failure) can leave a job in a non-terminal state indefinitely
  with nothing to detect and recover it automatically. This has been a
  known, deliberate gap since the project's original handoff and
  remains one — now at least visible via §2.3's new admin endpoint
  rather than invisible.
- **Docker containers run as root** — no `USER` directive in
  `backend/Dockerfile`. Standard hardening gap, not urgent for the
  documented dev-only compose setup, but worth fixing before the image
  is used as a production deployment artifact.
- **Single shared connection pool** (`knex` pool `max: 10`) is an
  env-tunable value, not an architectural ceiling — fine as-is, but
  worth explicitly sizing for real production concurrency before scale,
  not left at the dev default.
- **`usage_records` is an unbounded, ever-growing ledger.**
  `docs/COST.md` already flags this and defers a rollup table as a
  future scaling step "not needed at V1 volumes" — a reasonable,
  explicit deferral, not an oversight, but worth tracking as the ledger
  grows.

## 4. Low-priority improvements

- The 21 stale `eslint-disable` comments found in §2.6 could be turned
  into real enforced rules (`no-console`, `class-methods-use-this`,
  `no-await-in-loop`, `global-require`) instead of removed — would
  restore whatever intent those comments originally represented, but
  wasn't pursued further in this pass to avoid open-ended scope
  expansion of the lint config itself.
- No response caching headers on read-mostly endpoints (usage summary,
  etc.) — minor, not a correctness issue.

## 5. Cost risks

**Estimated Gemini API cost per video** (Gemini 3.6 Flash: $1.50/M
input tokens, $7.50/M output tokens, verified current pricing; ~4
chars/token; ~150 spoken words/minute; using this app's actual chunking
logic — `content.analyze` splits the transcript into up to 8 chunks of
12,000 chars each, `clips.detect` and each of the 5 `content.generate`
calls use the full transcript unchunked):

| Video length | AI calls | Input tokens | Output tokens | Estimated cost |
|---|---|---|---|---|
| 10 min | 7 | ~16,000 | ~4,150 | **$0.055** |
| 30 min | 9 | ~45,000 | ~5,150 | **$0.107** |
| 60 min | 11 | ~89,000 | ~6,150 | **$0.180** |
| 120 min | 14 | ~177,000 | ~7,650 | **$0.322** |

These are estimates with stated assumptions (average output length per
content type, ~250 tokens of prompt/instruction overhead per call), not
lab-measured numbers — a real measurement pass against the live API
would tighten this. Note the 120-minute row exceeds this app's own
default `MAX_VIDEO_DURATION_SECONDS` (3600s = 60 min); processing a
2-hour video requires raising that limit first, which is itself a
deliberate cost/quality control, not an oversight.

**Most expensive operations, in order:**
1. `content.generate` — 5 full-transcript calls per job is the largest
   single cost driver at every video length (unlike `content.analyze`,
   it isn't chunked/capped the same way).
2. `clips.detect` — one full-transcript call; grows linearly with video
   length since nothing chunks it.
3. `content.analyze` — chunked and capped at 8 calls, so its *growth
   rate* flattens on longer videos even though its total token count
   keeps rising.
4. FFmpeg clip rendering — not a per-token API cost, but real compute
   time that becomes real infrastructure cost at scale; bounded by
   `MAX_CLIPS_PER_VIDEO` (default 10) and the FFmpeg timeout (§2.4).

**Cost reduction recommendations, without materially reducing quality:**
- Chunk `clips.detect`'s transcript the same way `content.analyze`
  already does, rather than sending it in full — clip detection doesn't
  need the entire transcript in one call to find good moments; this is
  the single highest-leverage change given it's currently the only
  unchunked, unbounded-by-length call.
- Consider generating fewer than all 5 content types by default, with
  the rest available on explicit user request (the endpoint architecture
  already supports per-type regeneration) — most users likely only care
  about 1-2 platforms per video.
- The now-real per-user daily and per-job ceilings (§2.1) are
  themselves the primary defense against a genuinely costly failure
  mode (runaway retries, an abusive account) — their absence was the
  actual biggest cost risk in this codebase before this review, bigger
  than any per-call optimization.

## 6. Security risks

A full, separate security audit was already conducted in an earlier
pass (`docs/SECURITY_AUDIT.md`) covering auth, authorization, file
upload, FFmpeg command construction, prompt injection, and dependency
CVEs, with fixes verified. Re-checked as part of this review:
- `npm audit`: **0 vulnerabilities** on both backend and frontend,
  confirmed fresh (not assumed stale-clean from the earlier pass).
- Transaction usage verified correct at every place that matters
  (registration + workspace creation, media upload + job creation, state
  transitions + event logging) — no partial-write risk found.
- The new admin endpoint (§2.3) was designed with the same "disabled by
  default, not open by default" posture as the rest of this app's
  security-relevant defaults.

No new security findings in this pass beyond what §2 already covers
(the admin-endpoint gating itself, and confirming the previously-known
gaps like the missing stuck-job reaper don't have a security dimension
beyond the operational one already noted).

## 7. Scalability risks

- §2.2's missing index was the concrete one — fixed.
- The unbounded `usage_records` ledger (§3) is a known, deferred risk,
  not an unknown one.
- No global docker resource limits exist, but `docker-compose.yml` is
  explicitly documented as dev-only (its own header comment says so),
  and `docs/DEPLOYMENT.md` covers the real production topology
  separately — not a gap in the artifact that's actually meant to run
  at scale.
- Queue concurrency (`QUEUE_CONCURRENCY_DEFAULT=2`,
  `QUEUE_CONCURRENCY_TRANSCRIPTION=1`) is conservative and
  env-tunable — appropriate for a review to flag as "will need raising
  before real load," not as a bug.

## 8. Technical debt

- The 21 stale lint-disable comments (§2.6/§4).
- No automated frontend test harness exists (Next.js's own build-time
  checks are what currently guards it) — noted previously in
  `docs/RELEASE_READINESS.md`, still true.
- The admin-endpoint shared-secret pattern (§2.3) is a deliberately
  small stopgap; if this app grows a real multi-admin operational team,
  it should become a proper role-gated feature rather than one shared
  key.

## 9. Recommended fixes (not implemented this pass)

In priority order, for whoever picks this up next:
1. Chunk `clips.detect`'s transcript input (§5) — highest-leverage
   remaining cost optimization.
2. Build a stuck-job reaper (§3) — the most significant remaining
   reliability gap, now at least visible rather than invisible.
3. Add a `USER` directive to `backend/Dockerfile` before it's used as a
   real production deployment artifact.
4. Decide whether the 21 stale lint-disable comments (§8) should become
   real enforced rules or be removed, rather than left as inert noise.
5. A `usage_records` daily rollup table, whenever the ledger's row count
   actually starts to matter (deliberately deferred, not urgent).
