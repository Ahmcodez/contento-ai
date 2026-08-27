const config = require('../config');
const LocalDiskStorageDriver = require('./LocalDiskStorageDriver');
const S3StorageDriver = require('./S3StorageDriver');

let instance;

function getStorageDriver() {
  if (!instance) {
    if (config.storage.driver === 'local') {
      instance = new LocalDiskStorageDriver(config.storage.localPath);
    } else if (config.storage.driver === 's3') {
      instance = new S3StorageDriver(config.storage.s3);
    } else {
      throw new Error(`Unsupported STORAGE_DRIVER: ${config.storage.driver}`);
    }
  }
  return instance;
}

module.exports = { getStorageDriver };
