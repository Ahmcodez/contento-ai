const { z } = require('zod');

require('dotenv').config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Express's `trust proxy` setting — see docs/SECURITY.md §6 and
  // docs/DEPLOYMENT.md before changing this. Controls what req.ip
  // resolves to, which per-IP rate limiting (src/middleware/rateLimiter.js)
  // depends on directly. Accepts: 'false' (no proxy — trust the direct
  // socket address only; the safe default for local/Docker dev, where
  // there is no reverse proxy in front of the app), a positive integer
  // (the number of reverse-proxy hops in front of the app to trust — set
  // this to match the real deployment topology in production, e.g. '1'
  // for a single load balancer), or any other Express-recognized value
  // ('true', 'loopback', a specific IP/CIDR, etc.). Left unconfigured
  // (i.e. 'false') in production, every request appears to come from the
  // load balancer's IP, so per-IP auth rate limiting silently stops
  // working — either every user shares one bucket, or none of them do.
  // Set too permissively ('true' when the app is directly internet-
  // facing), the client-supplied X-Forwarded-For header becomes
  // spoofable, which defeats the same rate limiting the other way.
  TRUST_PROXY: z.string().default('false'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),

  // Gates the internal /api/v1/admin/* routes (queue/job observability —
  // see src/routes/admin.routes.js). Optional, unset by default: with no
  // key configured the routes are disabled outright (404), not silently
  // open. This app has no admin/role concept anywhere else yet (workspace
  // membership roles are a separate, workspace-scoped thing), so a full
  // RBAC system is out of scope here — a shared secret is the correctly
  // small solution for a single internal-ops endpoint, not a substitute
  // for real per-admin accounts if/when this app grows a proper admin
  // tier.
  ADMIN_API_KEY: z.string().optional(),

  AI_PROVIDER: z.enum(['gemini', 'none']).default('none'),
  GEMINI_API_KEY: z.string().optional(),
  // Google retires/renames Gemini model IDs on a roughly 3-6 month
  // cadence (gemini-1.5-flash, once this app's hardcoded default, is
  // fully shut down as of this writing — every real call would 404).
  // Making the model an env var, not a hardcoded string, means a
  // deprecation is a config change, not a code change/redeploy. Check
  // https://ai.google.dev/gemini-api/docs/changelog before updating this
  // default, since "current" here has a short shelf life by design.
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  // Real incident: the free tier's daily quota for gemini-3.6-flash can be
  // as low as 20 requests/day (varies per-project; Google only shows the
  // real number at https://aistudio.google.com/rate-limit — community
  // lists quoting a fixed number are often stale). When the primary model
  // hits a DAILY quota specifically (not the per-minute one, which the
  // rate limiter + retryAfterMs backoff already handle), GeminiProvider
  // falls back to this model for that one call, once, rather than failing
  // the whole job. Set to '' to disable fallback entirely.
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.5-flash-lite'),

  TRANSCRIPTION_PROVIDER: z.enum(['whisper-local', 'groq', 'none']).default('none'),
  // Groq's Whisper endpoint is OpenAI-compatible: hosted transcription,
  // paste-a-key setup, no server-side install (unlike whisper-local, which
  // shells out to a binary that must actually be present on the machine).
  // Cheapest available transcription as of this writing ($0.04/hr vs
  // OpenAI's $0.36/hr) with a real daily free allowance (not a one-time
  // credit) for the build/test phase — see docs/AI.md.
  GROQ_API_KEY: z.string().default(''),
  GROQ_TRANSCRIPTION_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  // Free tier hard-caps uploads at 25MB; paid tiers allow more. Kept
  // below Groq's own limit so this app's own error fires (with a clear
  // message) instead of a raw 413 from the API. Files above this are
  // transcoded first — see GroqTranscriptionProvider.js.
  GROQ_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(24),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
  STORAGE_TMP_PATH: z.string().default('./storage/tmp'),

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Set for any non-AWS S3-compatible provider (Backblaze B2, Cloudflare
  // R2, MinIO). Leave unset for real AWS S3.
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(500),
  // Default raised from 1 hour: a real podcast workload is routinely
  // 2+ hours, and the pipeline has no other hard-coded assumption tied
  // to 1 hour (transcription, clip detection and rendering all already
  // process whatever duration comes through). FFMPEG_TIMEOUT_MS and
  // YTDLP_DOWNLOAD_TIMEOUT_MS are the real ceilings on how long a single
  // stage may run — raise those too if you regularly process longer audio.
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(4 * 3600),
  // The most clips a user may ask for on one video, and the default when they don't say.
  MAX_CLIPS_PER_VIDEO: z.coerce.number().int().positive().default(20),
  DEFAULT_CLIPS_PER_VIDEO: z.coerce.number().int().positive().default(5),
  // Clips within one job render through a bounded-concurrency pool, not
  // fully sequentially: at up to 10 clips/video and ~36s/clip (see
  // FFMPEG_PRESET above), fully sequential rendering means a video with
  // many clips can take 5+ minutes just for this stage. Encoding is
  // CPU-bound, so this doesn't scale indefinitely with concurrency — kept
  // low and configurable rather than defaulting to something that could
  // starve a small/shared host. Each clip's render is still independently
  // caught (one failing never fails the others, same as before).
  CLIP_RENDER_CONCURRENCY_PER_JOB: z.coerce.number().int().positive().default(2),
  MAX_AI_REQUESTS_PER_USER_PER_DAY: z.coerce.number().int().positive().default(50),
  // Account-wide circuit breaker across *every* user combined — separate
  // from the per-user ceiling above. 0 (the default) disables it, since
  // a hard global ceiling isn't appropriate for every deployment (a
  // legitimately busy multi-tenant production instance could trip it
  // during ordinary traffic). Meant for a small shared dev/staging
  // environment, or as an emergency brake, where cheap insurance against
  // a runaway retry-loop bug burning through a budget overnight matters
  // more than the risk of false-positive throttling.
  MAX_TOTAL_AI_REQUESTS_PER_DAY: z.coerce.number().int().nonnegative().default(0),
  MAX_PROCESSING_JOBS_PER_USER_CONCURRENT: z.coerce.number().int().positive().default(2),
  MAX_PROJECTS_PER_USER: z.coerce.number().int().positive().default(50),
  MAX_PROCESSING_MINUTES_PER_USER_PER_MONTH: z.coerce.number().int().positive().default(300),

  // Larger chunks mean fewer AI calls (each repeats the instructions, and calls are what the
  // per-minute / per-day API limits count). 30k chars x 12 chunks covers ~7h of speech, so a
  // 4-hour video (MAX_VIDEO_DURATION_SECONDS) is no longer rejected at ~100 minutes.
  MAX_TRANSCRIPT_CHARS_PER_AI_CALL: z.coerce.number().int().positive().default(30000),
  MAX_TRANSCRIPT_CHUNKS: z.coerce.number().int().positive().default(12),
  MAX_AI_CALLS_PER_JOB: z.coerce.number().int().positive().default(30),
  MAX_GENERATED_CONTENT_TYPES: z.coerce.number().int().positive().default(5),
  AI_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Real incident: Gemini's free tier caps gemini-*-flash at 5 requests
  // PER MINUTE, project-wide, across every stage that calls it. The
  // ai-process queue's own concurrency (6, see QUEUE_CONCURRENCY_AI) was
  // sized against the old 3-queues-x-2 layout, not against this hard
  // external ceiling — so multiple jobs' analyze/detect/generate calls
  // could fire in parallel and blow through the quota before any single
  // call even got a chance to retry. This throttles how many AI calls
  // this app STARTS per window, via BullMQ's own rate limiter (proactive
  // throttling), instead of only reacting after Gemini rejects a call.
  // Raise this once billing is enabled — paid tiers allow far more RPM.
  QUEUE_AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  QUEUE_AI_RATE_LIMIT_DURATION_MS: z.coerce.number().int().positive().default(60 * 1000),

  // Clips scoring under this (0-100, see src/clips/scoring.js) are never made, even if that
  // means fewer than the number asked for: padding with weak clips is worse than fewer good ones.
  CLIP_MIN_FINAL_SCORE: z.coerce.number().min(0).max(100).default(30),
  // How long a clip playback link stays valid after the app asks for one. The app asks again when it expires.
  PLAYBACK_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  CLIP_MIN_DURATION_SECONDS: z.coerce.number().int().positive().default(15),
  CLIP_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(90),

  CAPTION_FONT: z.string().default('Arial'),
  CAPTION_FONT_SIZE: z.coerce.number().int().positive().default(48),
  CAPTION_MAX_CHARS_PER_LINE: z.coerce.number().int().positive().default(28),
  CAPTION_MAX_LINES: z.coerce.number().int().positive().default(2),
  CAPTION_SAFE_MARGIN_PERCENT: z.coerce.number().min(0).max(0.4).default(0.08),
  // Used only when the transcript has word-level timestamps (Groq and
  // WhisperLocalProvider both now request these — see
  // GroqTranscriptionProvider.js / WhisperLocalProvider.js). Groups words
  // into short, precisely-timed caption chunks instead of showing a whole
  // sentence for several seconds — the standard short-form caption style.
  // 4 is a reasonable default (roughly matches common 2-5 word captions);
  // transcripts without word-level data keep the previous one-cue-per-
  // segment behavior unchanged.
  CAPTION_MAX_WORDS_PER_CUE: z.coerce.number().int().positive().default(4),

  FFMPEG_OUTPUT_MAX_SIZE_MB: z.coerce.number().int().positive().default(200),
  // Real measurement (10-minute 720p source, 60s clip, this app's real
  // crop+scale+subtitle filter chain): libx264's default preset ("medium",
  // used when none is specified — this app specified none until this was
  // added) took 68s. "veryfast" took 36s for virtually identical output
  // size (14.66MB vs 14.38MB) and 0.997 SSIM similarity against the
  // "medium" output — i.e. this is not a real quality trade, "medium" was
  // just leaving CPU time on the table for clip-length content. "superfast"
  // was faster still (25.5s) but nearly doubled file size (27.9MB) at the
  // same CRF, a bad trade for storage/bandwidth — "veryfast" is the
  // measured sweet spot, not a guess.
  FFMPEG_PRESET: z.string().default('veryfast'),
  FFMPEG_CRF: z.coerce.number().int().min(0).max(51).default(23),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  // Per-invocation ceiling for a single ffmpeg/ffprobe call. Was
  // previously a hardcoded 5-minute constant with no way to raise it
  // without a code change — a real risk for a legitimately large/slow
  // input on constrained production hardware, not just malicious/hung
  // input (which is what the timeout is actually meant to guard against).
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),

  // yt-dlp powers the YouTube/Vimeo/TikTok/Dropbox URL-import providers
  // (src/providers/) — a separate binary from ffmpeg, not bundled with
  // this app (the Docker image installs it; locally use `pip install
  // yt-dlp` or the release binary). See
  // docs/URL_IMPORT.md before changing YTDLP_PATH.
  YTDLP_PATH: z.string().default('yt-dlp'),
  // Metadata (-J, dump-JSON) is a single API-like call and should be
  // fast; a real download is a different, much longer-running operation
  // with its own timeout below. Separate limits because a slow metadata
  // fetch blocking the WAITING_CONFIRMATION preview for 10+ minutes
  // would be a bad user experience even though a 10-minute download
  // ceiling is perfectly reasonable.
  YTDLP_METADATA_TIMEOUT_MS: z.coerce.number().int().positive().default(20 * 1000),
  YTDLP_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  // Real production incident: a video with a large number of YouTube
  // auto-generated caption languages produced a `-J` (metadata) JSON
  // payload over 10MB, which exceeded Node's execFile stdout buffer and
  // failed deterministically on every retry (same video, same output
  // size, same limit — retrying never helps this specific error). This
  // is a safety-net ceiling; the actual fix is trimming the payload at
  // the source (see the extractor-args comment in getMetadataJson).
  YTDLP_METADATA_MAX_BUFFER_MB: z.coerce.number().int().positive().default(50),

  QUEUE_CONCURRENCY_DEFAULT: z.coerce.number().int().positive().default(2),
  // Default of 1 assumes local Whisper: CPU/RAM-bound, so parallel jobs
  // fight over the same resources. Groq transcription is network-bound
  // instead (the actual compute runs on Groq's hardware) — if
  // TRANSCRIPTION_PROVIDER=groq, raising this is safe and recommended;
  // Groq's own free-tier RPM limit (not this app) becomes the real cap.
  QUEUE_CONCURRENCY_TRANSCRIPTION: z.coerce.number().int().positive().default(1),
  // Shared-queue concurrency (see PHYSICAL_QUEUES in src/queue/queues.js).
  // LIGHT carries ms-to-seconds jobs (validate, audio extract, finalize, URL
  // metadata); measured 62ms / 1.1s per 10-min video, so 4 slots is ample.
  // AI carries the three Gemini stages; 6 = the old 3 queues x 2, i.e. the
  // same worst-case simultaneous provider calls as before. Concurrency
  // controls how many calls can be IN FLIGHT at once; QUEUE_AI_RATE_LIMIT_*
  // below controls how many can be STARTED per minute — the one that
  // actually matters against Gemini's free-tier 5 req/min quota. Both are
  // needed: concurrency alone doesn't prevent a burst of starts.
  QUEUE_CONCURRENCY_LIGHT: z.coerce.number().int().positive().default(4),
  QUEUE_CONCURRENCY_AI: z.coerce.number().int().positive().default(6),

  // How long an *idle* worker blocks on Redis waiting for work before it
  // wakes itself up and re-checks. New jobs and due retries wake a worker
  // immediately regardless of this value (BullMQ pushes a marker; delayed
  // jobs shorten the block to their due time), so this only controls the
  // idle heartbeat — BullMQ's default of 5s costs ~26 Redis commands/min
  // per queue forever, even with zero jobs. See docs/REDIS_OPTIMIZATION.md.
  QUEUE_DRAIN_DELAY_SECONDS: z.coerce.number().int().min(1).max(120).default(30),
  // How often each worker checks its queue for jobs whose owning worker
  // died (lock expired). Measured against BullMQ 5.81 with a SIGKILLed
  // worker: 30s -> orphaned job recovered in ~90s, 60s -> ~120s. Left at
  // BullMQ's own default on purpose: raising it saves only ~10 idle
  // commands/min for the whole worker fleet, which is not worth slowing
  // crash recovery. Must exceed BullMQ's lock renew time (15s).
  QUEUE_STALLED_INTERVAL_MS: z.coerce.number().int().min(15000).max(300000).default(30000),

  // Stuck-job reaper (src/workers/stuckJobReaper.js): finds jobs whose Postgres
  // state says "in progress" but that have no live BullMQ job behind them
  // (crash between a state change and the next enqueue, a Redis flush, a job
  // BullMQ gave up on as stalled) and re-enqueues or fails them.
  // Explicit enum, not z.coerce.boolean(): that turns the string "false" into true.
  REAPER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  REAPER_INTERVAL_MS: z.coerce.number().int().min(5000).max(3600000).default(60000),
  // A row must have sat untouched this long before it is even looked at. It only
  // has to cover the short gap between "state changed" and "next job added";
  // anything legitimately running still has a live BullMQ job and is skipped.
  REAPER_STUCK_AFTER_MS: z.coerce.number().int().min(1000).max(86400000).default(300000),
  // Re-enqueues allowed per job per stage before it is failed for good.
  REAPER_MAX_REQUEUES_PER_STAGE: z.coerce.number().int().min(0).max(10).default(2),
});

/**
 * Mirrors Express's own accepted `trust proxy` value types (see
 * https://expressjs.com/en/guide/behind-proxies.html) so operators can
 * use the exact same values they'd pass to `app.set('trust proxy', ...)`
 * directly, via a plain string env var. 'false'/'true' are parsed to
 * real booleans; anything that parses cleanly as a non-negative integer
 * becomes a number (hop count); everything else (e.g. 'loopback', a
 * specific IP/CIDR) is passed through unchanged.
 */
function parseTrustProxy(value) {
  if (value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const env = parsed.data;

  // Cross-field validation zod's schema alone can't express cleanly:
  // fail fast at boot, not mid-upload, if the storage driver is
  // misconfigured (mirrors the same fail-fast principle already applied
  // to AI provider config — see docs/COST.md §4).
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    console.error('Invalid environment configuration:');
    console.error('  - S3_BUCKET is required when STORAGE_DRIVER=s3');
    process.exit(1);
  }

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),

    databaseUrl: env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY,
    redisUrl: env.REDIS_URL,

    playbackUrlTtlSeconds: env.PLAYBACK_URL_TTL_SECONDS,

    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresInDays: env.JWT_REFRESH_EXPIRES_IN_DAYS,
    },

    ai: {
      provider: env.AI_PROVIDER,
      geminiApiKey: env.GEMINI_API_KEY,
      geminiModel: env.GEMINI_MODEL,
      geminiFallbackModel: env.GEMINI_FALLBACK_MODEL || null,
    },

    transcription: {
      provider: env.TRANSCRIPTION_PROVIDER,
      groqApiKey: env.GROQ_API_KEY,
      groqModel: env.GROQ_TRANSCRIPTION_MODEL,
      groqTimeoutMs: env.GROQ_TRANSCRIPTION_TIMEOUT_MS,
      groqMaxUploadBytes: env.GROQ_MAX_UPLOAD_MB * 1024 * 1024,
    },

    storage: {
      driver: env.STORAGE_DRIVER,
      localPath: env.STORAGE_LOCAL_PATH,
      tmpPath: env.STORAGE_TMP_PATH,
      s3: {
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      },
    },

    limits: {
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
      maxVideoDurationSeconds: env.MAX_VIDEO_DURATION_SECONDS,
      maxClipsPerVideo: env.MAX_CLIPS_PER_VIDEO,
      defaultClipsPerVideo: env.DEFAULT_CLIPS_PER_VIDEO,
      clipRenderConcurrencyPerJob: env.CLIP_RENDER_CONCURRENCY_PER_JOB,
      maxAiRequestsPerUserPerDay: env.MAX_AI_REQUESTS_PER_USER_PER_DAY,
      maxTotalAiRequestsPerDay: env.MAX_TOTAL_AI_REQUESTS_PER_DAY,
      maxProcessingJobsPerUserConcurrent: env.MAX_PROCESSING_JOBS_PER_USER_CONCURRENT,
      maxProjectsPerUser: env.MAX_PROJECTS_PER_USER,
      maxProcessingMinutesPerUserPerMonth: env.MAX_PROCESSING_MINUTES_PER_USER_PER_MONTH,
      maxTranscriptCharsPerAiCall: env.MAX_TRANSCRIPT_CHARS_PER_AI_CALL,
      maxTranscriptChunks: env.MAX_TRANSCRIPT_CHUNKS,
      maxAiCallsPerJob: env.MAX_AI_CALLS_PER_JOB,
      maxGeneratedContentTypes: env.MAX_GENERATED_CONTENT_TYPES,
      aiRetryAttempts: env.AI_RETRY_ATTEMPTS,
      clipMinFinalScore: env.CLIP_MIN_FINAL_SCORE,
      clipMinDurationSeconds: env.CLIP_MIN_DURATION_SECONDS,
      clipMaxDurationSeconds: env.CLIP_MAX_DURATION_SECONDS,
    },

    captions: {
      font: env.CAPTION_FONT,
      fontSize: env.CAPTION_FONT_SIZE,
      maxCharsPerLine: env.CAPTION_MAX_CHARS_PER_LINE,
      maxLines: env.CAPTION_MAX_LINES,
      safeMarginPercent: env.CAPTION_SAFE_MARGIN_PERCENT,
      maxWordsPerCue: env.CAPTION_MAX_WORDS_PER_CUE,
    },

    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      authMaxRequests: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
    },

    ffmpeg: {
      ffmpegPath: env.FFMPEG_PATH,
      ffprobePath: env.FFPROBE_PATH,
      outputMaxSizeMb: env.FFMPEG_OUTPUT_MAX_SIZE_MB,
      timeoutMs: env.FFMPEG_TIMEOUT_MS,
      preset: env.FFMPEG_PRESET,
      crf: env.FFMPEG_CRF,
    },

    ytdlp: {
      path: env.YTDLP_PATH,
      metadataTimeoutMs: env.YTDLP_METADATA_TIMEOUT_MS,
      downloadTimeoutMs: env.YTDLP_DOWNLOAD_TIMEOUT_MS,
      metadataMaxBufferBytes: env.YTDLP_METADATA_MAX_BUFFER_MB * 1024 * 1024,
    },

    queue: {
      concurrencyDefault: env.QUEUE_CONCURRENCY_DEFAULT,
      concurrencyTranscription: env.QUEUE_CONCURRENCY_TRANSCRIPTION,
      concurrencyLight: env.QUEUE_CONCURRENCY_LIGHT,
      concurrencyAi: env.QUEUE_CONCURRENCY_AI,
      aiRateLimitMax: env.QUEUE_AI_RATE_LIMIT_MAX,
      aiRateLimitDurationMs: env.QUEUE_AI_RATE_LIMIT_DURATION_MS,
      drainDelaySeconds: env.QUEUE_DRAIN_DELAY_SECONDS,
      stalledIntervalMs: env.QUEUE_STALLED_INTERVAL_MS,
    },

    reaper: {
      enabled: env.REAPER_ENABLED,
      intervalMs: env.REAPER_INTERVAL_MS,
      stuckAfterMs: env.REAPER_STUCK_AFTER_MS,
      maxRequeuesPerStage: env.REAPER_MAX_REQUEUES_PER_STAGE,
    },
  };
}

module.exports = loadConfig();
