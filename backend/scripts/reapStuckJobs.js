#!/usr/bin/env node

/**
 * One-off stuck-job sweep (`npm run reap`). The worker process already runs
 * this on a timer; this is for ops use, e.g. right after restoring Redis or
 * recovering from an outage, when you don't want to wait for the next sweep.
 * Honors REAPER_STUCK_AFTER_MS / REAPER_MAX_REQUEUES_PER_STAGE.
 */
const db = require('../src/db/client');
const redis = require('../src/redis/client');
const logger = require('../src/logger');
const { closeAllQueues } = require('../src/queue/queues');
const { sweep } = require('../src/workers/stuckJobReaper');

sweep()
  .then((result) => {
    logger.info(result, 'reap: sweep complete');
    console.log(JSON.stringify(result));
  })
  .then(() => closeAllQueues())
  .then(() => Promise.all([db.destroy(), redis.quit()]))
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err: err.message }, 'reap: failed');
    process.exit(1);
  });
