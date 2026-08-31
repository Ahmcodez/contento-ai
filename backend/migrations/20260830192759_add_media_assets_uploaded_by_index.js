/**
 * Fixes a real missing index found in a production-readiness review:
 * processingJobRepository.countActiveForUser() joins processing_jobs to
 * media_assets and filters on media_assets.uploaded_by — this query runs
 * on every single upload (the concurrent-job quota check). Without an
 * index on that column, it's a full sequential scan of media_assets,
 * which gets worse every time someone uploads a video. At "thousands of
 * users" scale this is exactly the kind of query that looks fine in dev
 * and then shows up as a real latency/CPU problem in production.
 *
 * CREATE INDEX CONCURRENTLY can't run inside a transaction, hence
 * `config.transaction = false` below — this is what makes the migration
 * safe to run against a live table without holding a lock that blocks
 * other uploads while the index builds.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS media_assets_uploaded_by_idx ON media_assets (uploaded_by)');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS media_assets_uploaded_by_idx');
};

exports.config = { transaction: false };
