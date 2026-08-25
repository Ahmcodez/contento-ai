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

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
  STORAGE_TMP_PATH: z.string().default('./storage/tmp'),

  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(500),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(3600),
  MAX_CLIPS_PER_VIDEO: z.coerce.number().int().positive().default(10),
  MAX_AI_REQUESTS_PER_USER_PER_DAY: z.coerce.number().int().positive().default(50),
  MAX_PROCESSING_JOBS_PER_USER_CONCURRENT: z.coerce.number().int().positive().default(2),

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
    },

    limits: {
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
      maxVideoDurationSeconds: env.MAX_VIDEO_DURATION_SECONDS,
      maxClipsPerVideo: env.MAX_CLIPS_PER_VIDEO,
      maxAiRequestsPerUserPerDay: env.MAX_AI_REQUESTS_PER_USER_PER_DAY,
      maxProcessingJobsPerUserConcurrent: env.MAX_PROCESSING_JOBS_PER_USER_CONCURRENT,
    },

    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      authMaxRequests: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
    },

    ffmpeg: {
      ffmpegPath: env.FFMPEG_PATH,
      ffprobePath: env.FFPROBE_PATH,
    },

    queue: {
      concurrencyDefault: env.QUEUE_CONCURRENCY_DEFAULT,
      concurrencyTranscription: env.QUEUE_CONCURRENCY_TRANSCRIPTION,
    },
  };
}

module.exports = loadConfig();
