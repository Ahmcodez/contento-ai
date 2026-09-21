/**
 * One-time migration after queue consolidation (see docs/QUEUE.md).
 *
 * Deploy order:
 *   1. Stop the OLD worker process gracefully (SIGTERM) so active jobs finish.
 *   2. npm run queues:migrate -- --dry-run     # see what would move
 *   3. npm run queues:migrate                  # move waiting/delayed/active jobs
 *   4. Start the NEW worker.
 *   5. Optional, once satisfied: npm run queues:migrate -- --obliterate
 *      to delete the now-empty legacy queue keys from Redis.
 *
 * Flags: --dry-run | --obliterate | --force (skip the "no live worker" check)
 */
const connection = require('../src/redis/client');
const { migrateLegacyQueues } = require('../src/queue/legacyMigration');

const args = new Set(process.argv.slice(2));

(async () => {
  const results = await migrateLegacyQueues({
    connection,
    dryRun: args.has('--dry-run'),
    obliterate: args.has('--obliterate'),
    force: args.has('--force'),
    log: (msg) => console.warn(msg),
  });
  console.table(results);
  const total = results.reduce((n, r) => n + r.moved, 0);
  console.log(`${args.has('--dry-run') ? 'Would move' : 'Moved'} ${total} job(s).`);
  await connection.quit();
})().catch(async (err) => {
  console.error(`Migration aborted: ${err.message}`);
  await connection.quit().catch(() => {});
  process.exit(1);
});
