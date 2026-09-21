const { PHYSICAL_QUEUES, STAGE_TO_QUEUE, getPhysicalQueue } = require('../queue/queues');
const asyncHandler = require('../utils/asyncHandler');

// Per-stage breakdown is derived from a bounded scan of each state's job
// list (per state, per queue). Totals in `counts` are always exact
// (BullMQ getJobCounts); if any state holds more than this many jobs the
// per-stage split is flagged `stagesTruncated`.
const STAGE_SCAN_LIMIT = 200;
const STAGE_STATES = ['waiting', 'active', 'delayed', 'failed'];

/**
 * Real, minimal queue/job observability. Not a Bull Board-style UI (that
 * remains a reasonable future addition, not implemented here — see
 * docs/RELEASE_READINESS.md) — just the counts an operator actually
 * needs to answer "is anything stuck?" without shelling into Redis or
 * the database directly. BullMQ's own getJobCounts() is the source of
 * truth for each number; nothing here is derived/cached.
 *
 * One entry per *physical* queue. Since several pipeline stages share a
 * queue (see PHYSICAL_QUEUES), each entry also lists the stages it carries
 * and a per-stage state breakdown so "which stage is backed up?" is still
 * answerable.
 */
const getQueueSummary = asyncHandler(async (req, res) => {
  const summaries = await Promise.all(
    Object.values(PHYSICAL_QUEUES).map(async (name) => {
      const queue = getPhysicalQueue(name);
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');

      const jobs = await queue.getJobs(STAGE_STATES, 0, STAGE_SCAN_LIMIT - 1);
      const stages = {};
      for (const job of jobs) {
        const state = await job.getState();
        stages[job.name] = stages[job.name] || { waiting: 0, active: 0, delayed: 0, failed: 0 };
        if (stages[job.name][state] !== undefined) stages[job.name][state] += 1;
      }
      const stagesTruncated = STAGE_STATES.some((state) => counts[state] > STAGE_SCAN_LIMIT);

      return {
        queue: name,
        stagesCarried: Object.keys(STAGE_TO_QUEUE).filter((stage) => STAGE_TO_QUEUE[stage] === name),
        counts,
        stages,
        stagesTruncated,
      };
    }),
  );

  res.status(200).json({ data: summaries });
});

module.exports = { getQueueSummary };
