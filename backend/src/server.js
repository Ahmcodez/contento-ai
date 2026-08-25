const createApp = require('./app');
const config = require('./config');
const logger = require('./logger');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`API listening on port ${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
