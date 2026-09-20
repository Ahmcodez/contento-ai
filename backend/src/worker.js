const logger = require('./logger');
const { startWorkers, stopWorkers } = require('./workers');
const { checkStartupDependencies } = require('./workers/checkStartupDependencies');

// Fire-and-forget: advisory only, never blocks the worker from starting
// to process jobs. Logs a loud WARN in the first couple seconds of
// startup if ffmpeg/ffprobe/yt-dlp aren't actually reachable at their
// configured paths, rather than that only surfacing later, deep inside
// a specific job's failure.
checkStartupDependencies();
const workers = startWorkers();

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down workers`);
  stopWorkers(workers).finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
