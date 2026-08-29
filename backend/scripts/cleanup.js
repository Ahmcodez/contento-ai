#!/usr/bin/env node

/**
 * Cleanup jobs for state that legitimately accumulates and needs
 * periodic pruning — not part of the request-serving hot path. Run
 * manually (`npm run cleanup`) or on a schedule (cron, a scheduled
 * platform job, etc. — see docs/OPERATIONS.md). Every operation here is
 * safe to run repeatedly and safe to run concurrently with the app.
 */
const fs = require('fs/promises');
const path = require('path');
const db = require('../src/db/client');
const config = require('../src/config');
const logger = require('../src/logger');

const REFRESH_TOKEN_RETENTION_DAYS = 7; // how long to keep revoked/expired tokens for audit before purging
const TMP_FILE_MAX_AGE_HOURS = 6; // safety net for interrupted uploads/renders that never got cleaned up

/**
 * Deletes refresh tokens that are expired, or were revoked more than
 * REFRESH_TOKEN_RETENTION_DAYS ago. Keeping recently-revoked tokens
 * briefly (rather than deleting immediately on revoke) preserves a short
 * forensic window for investigating suspicious refresh activity.
 */
async function cleanupExpiredRefreshTokens() {
  const retentionCutoff = new Date(Date.now() - REFRESH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deleted = await db('refresh_tokens')
    .where('expires_at', '<', db.fn.now())
    .orWhere((qb) => qb.whereNotNull('revoked_at').andWhere('revoked_at', '<', retentionCutoff))
    .del();

  logger.info({ deleted }, 'cleanup: expired/stale refresh tokens removed');
  return deleted;
}

/**
 * Removes files sitting in the local temp upload/processing directory
 * older than TMP_FILE_MAX_AGE_HOURS. Normal operation always cleans up
 * its own temp files (see media.service.js, clipRender.service.js
 * `finally` blocks) — this is a safety net for the case where a process
 * crashed mid-operation and left orphans behind.
 */
async function cleanupOrphanedTempFiles() {
  const tmpDir = path.resolve(config.storage.tmpPath);
  let entries;
  try {
    entries = await fs.readdir(tmpDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.info({ tmpDir }, 'cleanup: temp directory does not exist, nothing to do');
      return 0;
    }
    throw err;
  }

  const cutoffMs = Date.now() - TMP_FILE_MAX_AGE_HOURS * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of entries) {
    const entryPath = path.join(tmpDir, entry.name);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat) continue; // removed by something else between readdir and stat

    if (stat.mtimeMs < cutoffMs) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(entryPath, { recursive: true, force: true });
      removed += 1;
    }
  }

  logger.info({ removed, tmpDir }, 'cleanup: orphaned temp files removed');
  return removed;
}

async function runAll() {
  const results = {
    refreshTokensDeleted: await cleanupExpiredRefreshTokens(),
    tmpFilesRemoved: await cleanupOrphanedTempFiles(),
  };
  return results;
}

// Run directly (`node scripts/cleanup.js` / `npm run cleanup`) vs.
// imported for testing.
if (require.main === module) {
  runAll()
    .then((results) => {
      logger.info(results, 'cleanup: complete');
      return db.destroy();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err: err.message }, 'cleanup: failed');
      process.exit(1);
    });
}

module.exports = { cleanupExpiredRefreshTokens, cleanupOrphanedTempFiles, runAll };
