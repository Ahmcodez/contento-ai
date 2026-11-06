const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../redis/client');
const config = require('../config');
const AppError = require('../utils/AppError');

function makeLimiter({ windowMs, max, prefix, skip }) {
  return rateLimit({
    windowMs,
    max,
    skip,
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

// Status polling (every second or two while a download is prepared) has its own, separate limit,
// so a visitor watching a download is not counted against the general API budget.
const TOOL_STATUS_PATH = /^\/api\/v1\/tools\/downloader\/jobs\/[a-f0-9]{32}$/;

const generalLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: () => config.rateLimit.maxRequests,
  prefix: 'rl:general:',
  skip: (req) => req.method === 'GET' && TOOL_STATUS_PATH.test(req.originalUrl.split('?')[0]),
});

const toolSettings = () => config.tools.downloader;
// `max` as a function: the limit is read on each request, so changing it (config reload, tests) takes effect immediately.
const toolInfoLimiter = makeLimiter({ windowMs: 60 * 1000, max: () => toolSettings().infoPerMinutePerIp, prefix: 'rl:tool-info:' });
const toolDownloadLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, max: () => toolSettings().downloadsPerHourPerIp, prefix: 'rl:tool-dl:' });
const toolStatusLimiter = makeLimiter({ windowMs: 60 * 1000, max: 120, prefix: 'rl:tool-status:' });

const authLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMaxRequests,
  prefix: 'rl:auth:',
});

module.exports = { generalLimiter, authLimiter, toolInfoLimiter, toolDownloadLimiter, toolStatusLimiter };
