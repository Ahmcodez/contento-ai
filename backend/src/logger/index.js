const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.isTest ? 'silent' : config.isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
