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
    // A rate limiter is a defense-in-depth guard, not a core dependency —
    // if its own backing store has a problem (a Redis blip, a
    // first-connection hiccup, anything), the request it's guarding
    // should still go through rather than fail with an opaque 500.
    // express-rate-limit's default (passOnStoreError: false) throws the
    // store error straight into Express's error handler instead, which
    // is the wrong failure direction for what is meant to be a
    // best-effort safety net.
    passOnStoreError: true,
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
