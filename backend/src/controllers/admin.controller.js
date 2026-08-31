const { QUEUE_NAMES, getQueue } = require('../queue/queues');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Real, minimal queue/job observability. Not a Bull Board-style UI (that
 * remains a reasonable future addition, not implemented here — see
 * docs/RELEASE_READINESS.md) — just the counts an operator actually
 * needs to answer "is anything stuck?" without shelling into Redis or
 * the database directly. BullMQ's own getJobCounts() is the source of
 * truth for each number; nothing here is derived/cached.
 */
const getQueueSummary = asyncHandler(async (req, res) => {
  const summaries = await Promise.all(
    Object.values(QUEUE_NAMES).map(async (name) => {
      const queue = getQueue(name);
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      return { queue: name, counts };
    }),
  );

  res.status(200).json({ data: summaries });
});

module.exports = { getQueueSummary };
