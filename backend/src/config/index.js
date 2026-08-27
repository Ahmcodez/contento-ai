const { z } = require('zod');

require('dotenv').config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),

  AI_PROVIDER: z.enum(['gemini', 'none']).default('none'),
  GEMINI_API_KEY: z.string().optional(),

  TRANSCRIPTION_PROVIDER: z.enum(['whisper-local', 'none']).default('none'),

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
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(3600),
  MAX_CLIPS_PER_VIDEO: z.coerce.number().int().positive().default(10),
  MAX_AI_REQUESTS_PER_USER_PER_DAY: z.coerce.number().int().positive().default(50),
  MAX_PROCESSING_JOBS_PER_USER_CONCURRENT: z.coerce.number().int().positive().default(2),

  MAX_TRANSCRIPT_CHARS_PER_AI_CALL: z.coerce.number().int().positive().default(12000),
  MAX_TRANSCRIPT_CHUNKS: z.coerce.number().int().positive().default(8),
  MAX_AI_CALLS_PER_JOB: z.coerce.number().int().positive().default(20),
  MAX_GENERATED_CONTENT_TYPES: z.coerce.number().int().positive().default(5),
  AI_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),

  CLIP_MIN_DURATION_SECONDS: z.coerce.number().int().positive().default(15),
  CLIP_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(90),

  CAPTION_FONT: z.string().default('Arial'),
  CAPTION_FONT_SIZE: z.coerce.number().int().positive().default(48),
  CAPTION_MAX_CHARS_PER_LINE: z.coerce.number().int().positive().default(28),
  CAPTION_MAX_LINES: z.coerce.number().int().positive().default(2),
  CAPTION_SAFE_MARGIN_PERCENT: z.coerce.number().min(0).max(0.4).default(0.08),

  FFMPEG_OUTPUT_MAX_SIZE_MB: z.coerce.number().int().positive().default(200),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  QUEUE_CONCURRENCY_DEFAULT: z.coerce.number().int().positive().default(2),
  QUEUE_CONCURRENCY_TRANSCRIPTION: z.coerce.number().int().positive().default(1),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:');
    // eslint-disable-next-line no-console
    console.error('  - S3_BUCKET is required when STORAGE_DRIVER=s3');
    process.exit(1);
  }

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),

    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,

    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresInDays: env.JWT_REFRESH_EXPIRES_IN_DAYS,
    },

    ai: {
      provider: env.AI_PROVIDER,
      geminiApiKey: env.GEMINI_API_KEY,
    },

    transcription: {
      provider: env.TRANSCRIPTION_PROVIDER,
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
      maxAiRequestsPerUserPerDay: env.MAX_AI_REQUESTS_PER_USER_PER_DAY,
      maxProcessingJobsPerUserConcurrent: env.MAX_PROCESSING_JOBS_PER_USER_CONCURRENT,
      maxTranscriptCharsPerAiCall: env.MAX_TRANSCRIPT_CHARS_PER_AI_CALL,
      maxTranscriptChunks: env.MAX_TRANSCRIPT_CHUNKS,
      maxAiCallsPerJob: env.MAX_AI_CALLS_PER_JOB,
      maxGeneratedContentTypes: env.MAX_GENERATED_CONTENT_TYPES,
      aiRetryAttempts: env.AI_RETRY_ATTEMPTS,
      clipMinDurationSeconds: env.CLIP_MIN_DURATION_SECONDS,
      clipMaxDurationSeconds: env.CLIP_MAX_DURATION_SECONDS,
    },

    captions: {
      font: env.CAPTION_FONT,
      fontSize: env.CAPTION_FONT_SIZE,
      maxCharsPerLine: env.CAPTION_MAX_CHARS_PER_LINE,
      maxLines: env.CAPTION_MAX_LINES,
      safeMarginPercent: env.CAPTION_SAFE_MARGIN_PERCENT,
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
    },

    queue: {
      concurrencyDefault: env.QUEUE_CONCURRENCY_DEFAULT,
      concurrencyTranscription: env.QUEUE_CONCURRENCY_TRANSCRIPTION,
    },
  };
}

module.exports = loadConfig();
