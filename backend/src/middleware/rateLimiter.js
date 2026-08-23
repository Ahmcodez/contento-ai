const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../redis/client');
const config = require('../config');
const AppError = require('../utils/AppError');

function makeLimiter({ windowMs, max, prefix }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: config.isTest
      ? undefined // in-memory store for tests — no Redis dependency in unit tests
      : new RedisStore({
          sendCommand: (...args) => redis.call(...args),
          prefix,
        }),
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : req.ip),
    handler: (req, res, next) => {
      next(AppError.tooManyRequests('Too many requests, please try again later'));
    },
  });
}

const generalLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  prefix: 'rl:general:',
});

const authLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMaxRequests,
  prefix: 'rl:auth:',
});

module.exports = { generalLimiter, authLimiter };
