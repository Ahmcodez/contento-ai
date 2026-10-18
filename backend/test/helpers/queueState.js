const { PHYSICAL_QUEUES, getPhysicalQueue } = require('../../src/queue/queues');

/**
 * BullMQ keeps the AI queue's rate-limiter counter in Redis, keyed by queue name,
 * and every test file shares the same Redis DB. A test that runs real workers
 * leaves that counter behind (about 3 per pipeline, for up to a minute), so the
 * next worker-based test file can start with the 5/minute budget half spent and
 * stall waiting for the window to expire.
 *
 * obliterate() clears leftover jobs but NOT the limiter key (checked), so the key
 * is deleted explicitly. Uses the queue's own connection, so it is safe to call
 * from afterAll even after the shared Redis client has been closed. Call it when
 * a worker-based test starts and when it finishes.
 */
async function resetAiQueueState() {
  const queue = getPhysicalQueue(PHYSICAL_QUEUES.AI);
  await queue.obliterate({ force: true });
  const client = await queue.client;
  await client.del(queue.toKey('limiter'));
}

module.exports = { resetAiQueueState };
