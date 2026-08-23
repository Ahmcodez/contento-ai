const logger = require('./logger');
const { startWorkers } = require('./workers');

const workers = startWorkers();

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down workers`);
  Promise.all(workers.map((w) => w.close())).finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
