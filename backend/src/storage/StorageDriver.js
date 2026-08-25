/**
 * StorageDriver — abstraction over where media binaries live.
 * See docs/ARCHITECTURE.md §2.5 and docs/adr/007-storage-driver-abstraction.md.
 *
 * All keys are opaque, server-generated strings — never derived from
 * client-supplied filenames (see src/utils/sanitize.js).
 */
class StorageDriver {
  /* eslint-disable class-methods-use-this, no-unused-vars */
  async saveFromPath(key, sourcePath) {
    throw new Error('StorageDriver.saveFromPath not implemented');
  }

  async getReadStream(key) {
    throw new Error('StorageDriver.getReadStream not implemented');
  }

  async getAbsolutePath(key) {
    throw new Error('StorageDriver.getAbsolutePath not implemented');
  }

  async exists(key) {
    throw new Error('StorageDriver.exists not implemented');
  }

  async delete(key) {
    throw new Error('StorageDriver.delete not implemented');
  }

  async size(key) {
    throw new Error('StorageDriver.size not implemented');
  }
  /* eslint-enable class-methods-use-this, no-unused-vars */
}

module.exports = StorageDriver;
