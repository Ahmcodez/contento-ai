const IORedis = require('ioredis');
const config = require('../config');

// BullMQ requires maxRetriesPerRequest: null on the connection it manages.
const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

connection.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Redis connection error:', err.message);
});

module.exports = connection;
