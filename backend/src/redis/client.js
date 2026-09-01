const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../logger');

/**
 * Options shared by every ioredis connection this app creates (the base
 * connection below, plus every BullMQ .duplicate() connection created
 * from it in src/queue/queues.js and src/workers/index.js).
 *
 *  - keepAlive: sends TCP-level keepalive probes so idle connections
 *    aren't silently dropped by NAT/firewalls/managed Redis providers
 *    before either side notices — this is the single most common real
 *    cause of a spontaneous "read ECONNRESET" against hosted Redis
 *    (Upstash, Redis Cloud, etc.), which otherwise looks like nothing is
 *    wrong until the connection is already gone.
 *  - retryStrategy: explicit, visible exponential backoff with a sane
 *    cap, rather than relying on ioredis's undocumented default. Retries
 *    forever (this is a long-lived worker process, not a request that
 *    should give up) but never waits longer than 5s between attempts.
 *  - maxRetriesPerRequest: null is required by BullMQ on any connection
 *    it manages (see https://docs.bullmq.io) — BullMQ does its own
 *    retry/backoff bookkeeping and this must not fight it.
 */
const REDIS_CONNECTION_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  keepAlive: 30000,
  retryStrategy(attempt) {
    return Math.min(attempt * 200, 5000);
  },
};

const connection = new IORedis(config.redisUrl, REDIS_CONNECTION_OPTIONS);

connection.on('error', (err) => {
  logger.warn({ err: err.message }, 'redis connection error (ioredis will retry automatically)');
});

connection.on('reconnecting', (delayMs) => {
  logger.info({ delayMs }, 'redis reconnecting');
});

connection.on('ready', () => {
  logger.info('redis connection ready');
});

module.exports = connection;
module.exports.REDIS_CONNECTION_OPTIONS = REDIS_CONNECTION_OPTIONS;
