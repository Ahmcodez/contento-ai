const config = require('../config');
const LocalDiskStorageDriver = require('./LocalDiskStorageDriver');

let instance;

function getStorageDriver() {
  if (!instance) {
    if (config.storage.driver === 'local') {
      instance = new LocalDiskStorageDriver(config.storage.localPath);
    } else {
      throw new Error(`Unsupported STORAGE_DRIVER: ${config.storage.driver}`);
    }
  }
  return instance;
}

module.exports = { getStorageDriver };
