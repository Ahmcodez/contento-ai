const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');

const logger = require('./logger');
const config = require('./config');
const metrics = require('./metrics');
const asyncHandler = require('./utils/asyncHandler');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const mediaRoutes = require('./routes/media.routes');
const jobRoutes = require('./routes/job.routes');
const clipRoutes = require('./routes/clip.routes');
const contentRoutes = require('./routes/content.routes');
const usageRoutes = require('./routes/usage.routes');
const adminRoutes = require('./routes/admin.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Must be set before any middleware that reads req.ip — the rate
  // limiter below keys directly off it (src/middleware/rateLimiter.js).
  // See the TRUST_PROXY doc comment in src/config/index.js for what this
  // controls and why getting it wrong in either direction is a real
  // problem, not just a config nicety.
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header (server-to-server, curl, mobile apps) is allowed
        // through — only browser cross-origin requests carry this header,
        // and those are the ones this allowlist is meant to constrain.
        if (!origin || config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
      autoLogging: !config.isTest,
    }),
  );

  // Body size cap protects against oversized JSON payloads independent of
  // the separate, stricter multipart upload size limit (see media routes).
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(generalLimiter);

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.get('/health/ready', asyncHandler(async (req, res) => {
    const db = require('./db/client');
    const redis = require('./redis/client');
    const checks = {};

    try {
      await db.raw('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'unreachable';
    }

    checks.redis = redis.status === 'ready' ? 'ok' : redis.status;

    const healthy = checks.database === 'ok' && checks.redis === 'ok';
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
  }));

  // Not authenticated deliberately — this is operational visibility, not
  // business data (docs/OPERATIONS.md). If this ever needs to be public-
  // internet-facing, put it behind network restrictions or basic auth
  // rather than app-level auth, since it's infra tooling, not a user API.
  app.get('/metrics', (req, res) => {
    res.status(200).json(metrics.snapshot());
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1', mediaRoutes);
  app.use('/api/v1', jobRoutes);
  app.use('/api/v1', clipRoutes);
  app.use('/api/v1', contentRoutes);
  app.use('/api/v1', usageRoutes);
  app.use('/api/v1/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
