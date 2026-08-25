const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');

const logger = require('./logger');
const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const mediaRoutes = require('./routes/media.routes');
const jobRoutes = require('./routes/job.routes');
const clipRoutes = require('./routes/clip.routes');
const contentRoutes = require('./routes/content.routes');
const usageRoutes = require('./routes/usage.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
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

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1', mediaRoutes);
  app.use('/api/v1', jobRoutes);
  app.use('/api/v1', clipRoutes);
  app.use('/api/v1', contentRoutes);
  app.use('/api/v1', usageRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
