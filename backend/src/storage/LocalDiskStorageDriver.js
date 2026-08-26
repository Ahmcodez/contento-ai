const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const StorageDriver = require('./StorageDriver');
const metrics = require('../metrics');
const logger = require('../logger');

class LocalDiskStorageDriver extends StorageDriver {
  constructor(rootPath) {
    super();
    this.root = path.resolve(rootPath);
  }

  /**
   * Resolves a storage key to an absolute path, guaranteeing the result
   * stays inside the storage root (defense against path traversal even
   * though keys are always server-generated, never client-supplied).
   */
  resolveKey(key) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      throw new Error(`Storage key resolves outside storage root: ${key}`);
    }
    return resolved;
  }

  async saveFromPath(key, sourcePath) {
    const dest = this.resolveKey(key);
    try {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(sourcePath, dest);
      return key;
    } catch (err) {
      metrics.increment('storage_error', { operation: 'saveFromPath' });
      logger.error({ err: err.message, key }, 'storage: saveFromPath failed');
      throw err;
    }
  }

  async getReadStream(key) {
    // Note: fs.createReadStream does not throw synchronously for a
    // missing/unreadable file — that surfaces as an async 'error' event
    // on the returned stream. Callers (e.g. clip.controller.js) listen
    // for that event and record storage_error there; this try/catch only
    // covers the rarer synchronous failure (e.g. an invalid path).
    const abs = this.resolveKey(key);
    try {
      return fs.createReadStream(abs);
    } catch (err) {
      metrics.increment('storage_error', { operation: 'getReadStream' });
      logger.error({ err: err.message, key }, 'storage: getReadStream failed synchronously');
      throw err;
    }
  }

  async getAbsolutePath(key) {
    return this.resolveKey(key);
  }

  async exists(key) {
    try {
      await fsp.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key) {
    const abs = this.resolveKey(key);
    await fsp.rm(abs, { force: true });
  }

  async size(key) {
    const abs = this.resolveKey(key);
    const stat = await fsp.stat(abs);
    return stat.size;
  }
}

module.exports = LocalDiskStorageDriver;
