const logger = require('./logger');
const config = require('./config');
const { startWorkers, stopWorkers } = require('./workers');
const { startReaper } = require('./workers/stuckJobReaper');
const { checkStartupDependencies } = require('./workers/checkStartupDependencies');

// Fire-and-forget: advisory only, never blocks the worker from starting
// to process jobs. Logs a loud WARN in the first couple seconds of
// startup if ffmpeg/ffprobe/yt-dlp aren't actually reachable at their
// configured paths, rather than that only surfacing later, deep inside
// a specific job's failure.
checkStartupDependencies();
const workers = startWorkers();

// Recovers jobs whose DB state says "in progress" but that have no live queue
// job (see src/workers/stuckJobReaper.js). Safe to run in every worker process:
// sweeps are guarded by a Redis lock and a per-row claim.
const reaper = config.reaper.enabled ? startReaper() : null;
if (!reaper) logger.warn('stuck-job reaper disabled (REAPER_ENABLED=false)');

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down workers`);
  if (reaper) reaper.stop();
  stopWorkers(workers).finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
