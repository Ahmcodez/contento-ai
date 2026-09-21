const { Queue } = require('bullmq');
const {
  LEGACY_QUEUE_TO_STAGE,
  RETRY_CONFIG,
  STAGE_TO_QUEUE,
  getPhysicalQueue,
} = require('./queues');

const MOVABLE_STATES = ['waiting', 'prioritized', 'delayed', 'active'];

/**
 * One-time move of jobs from the pre-consolidation queues (one per stage)
 * into the shared physical queue that now carries their stage.
 *
 * Safety rules:
 *  - Refuses to touch a legacy queue while a live worker is attached to it
 *    (a live worker would either double-process the job or lose its lock),
 *    unless `force` is passed. If liveness can't be determined (some
 *    managed Redis providers block CLIENT LIST) it also refuses without
 *    `force` — the caller must confirm the old worker is stopped.
 *  - Adds to the new queue BEFORE removing from the old one, so a crash
 *    mid-migration can duplicate a job (stage handlers are idempotent via
 *    their state guards) but never lose one.
 *  - Preserves the remaining retry budget: attempts already consumed are
 *    subtracted so migration can't hand a failing job a fresh set of tries.
 *  - Preserves delays: a backoff/delayed job keeps its original due time.
 *  - Failed jobs are left alone; the durable failure record is in Postgres
 *    (processing_errors), not the Redis failed set.
 */
async function migrateLegacyQueues({ connection, dryRun = false, obliterate = false, force = false, log = () => {} }) {
  const results = [];

  for (const [legacyName, stage] of Object.entries(LEGACY_QUEUE_TO_STAGE)) {
    const legacy = new Queue(legacyName, { connection: connection.duplicate() });
    const result = { legacy: legacyName, target: STAGE_TO_QUEUE[stage], moved: 0, delayed: 0, active: 0, skipped: 0, obliterated: false };

    try {
      let live = [];
      let livenessKnown = true;
      try {
        live = await legacy.getWorkers();
      } catch {
        livenessKnown = false;
      }
      if (!force && (live.length > 0 || !livenessKnown)) {
        throw new Error(
          live.length > 0
            ? `Legacy queue "${legacyName}" still has ${live.length} live worker connection(s). Stop the old worker first (or pass --force).`
            : `Could not verify that no worker is attached to legacy queue "${legacyName}". Stop the old worker and pass --force to confirm.`,
        );
      }

      const target = getPhysicalQueue(STAGE_TO_QUEUE[stage]);
      const jobs = await legacy.getJobs(MOVABLE_STATES, 0, -1);

      for (const job of jobs) {
        const state = await job.getState();
        const remainingAttempts = Math.max(1, (job.opts.attempts || 1) - job.attemptsMade);
        const opts = {
          ...RETRY_CONFIG[stage],
          attempts: remainingAttempts,
          removeOnComplete: 100,
          removeOnFail: 500,
        };
        if (state === 'delayed') {
          opts.delay = Math.max(0, job.timestamp + (job.opts.delay || 0) - Date.now());
        }

        if (dryRun) {
          result.moved += 1;
          continue;
        }

        await target.add(job.name, job.data, opts);
        try {
          await job.remove();
        } catch (err) {
          // Locked/active job we could not remove: the copy already exists
          // in the new queue, so surface it instead of failing the run.
          result.skipped += 1;
          log(`could not remove ${legacyName}#${job.id} after copying it: ${err.message}`);
          continue;
        }
        result.moved += 1;
        if (state === 'delayed') result.delayed += 1;
        if (state === 'active') result.active += 1;
      }

      if (obliterate && !dryRun) {
        await legacy.obliterate({ force: false });
        result.obliterated = true;
      }
    } finally {
      const dup = legacy.opts.connection;
      await legacy.close();
      if (dup) await dup.quit().catch(() => {});
    }
    results.push(result);
  }

  return results;
}

module.exports = { migrateLegacyQueues };
