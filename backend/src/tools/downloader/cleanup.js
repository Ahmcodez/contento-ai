const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../logger');
const { getStorageDriver } = require('../../storage');
const store = require('./jobStore');

const WORK_ROOT = () => path.join(config.storage.tmpPath, 'tool-downloads');
const STALE_WORKDIR_MS = 2 * 3600 * 1000;

/**
 * Deletes finished downloads once they are past their expiry, and any temp folder a crashed
 * worker left behind. Public downloads are meant to be disposable: nothing here should outlive
 * the visitor's use of it, both to bound disk/storage cost and so files aren't kept around.
 * Returns how many files were removed.
 */
async function sweep({ now = Date.now() } = {}) {
  const dueIds = await store.dueForExpiry(now);
  let removed = 0;

  for (const id of dueIds) {
     
    const job = await store.get(id);
    if (job && job.storageKey) {
       
      await getStorageDriver().delete(job.storageKey).catch((err) => logger.warn({ err: err.message }, 'could not delete expired public download'));
       
      await store.update(id, { state: 'expired', storageKey: null });
      removed += 1;
    }
     
    await store.clearExpiry(id);
  }

  // Orphaned temp folders (a worker killed mid-download).
  try {
    for (const entry of fs.readdirSync(WORK_ROOT())) {
      const dir = path.join(WORK_ROOT(), entry);
      if (now - fs.statSync(dir).mtimeMs > STALE_WORKDIR_MS) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // no work root yet: nothing to clean
  }

  return removed;
}

/** Runs sweep() on a timer inside the worker process. Returns { stop }. */
function startSweeper({ intervalMs = 5 * 60 * 1000 } = {}) {
  const run = () => sweep().catch((err) => logger.error({ err: err.message }, 'public download cleanup failed'));
  const first = setTimeout(run, 10000);
  const timer = setInterval(run, intervalMs);
  first.unref();
  timer.unref();
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

module.exports = { sweep, startSweeper };
