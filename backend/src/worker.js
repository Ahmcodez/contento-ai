const logger = require('./logger');
const { startWorkers, stopWorkers } = require('./workers');

const workers = startWorkers();

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down workers`);
  stopWorkers(workers).finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
