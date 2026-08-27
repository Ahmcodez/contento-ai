const { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const StorageDriver = require('./StorageDriver');
const metrics = require('../metrics');
const logger = require('../logger');

/**
 * S3-compatible implementation of StorageDriver — the production path
 * referenced in docs/ARCHITECTURE.md §2.5 and ADR-007. Targets the
 * S3-*compatible* API specifically (not AWS-SDK-only features), so
 * Backblaze B2, Cloudflare R2, and MinIO all work by pointing
 * S3_ENDPOINT at them — not locked to AWS.
 *
 * `getAbsolutePath` has no real filesystem equivalent for object
 * storage — it downloads to a local temp path on demand, since a couple
 * of callers (FFmpeg, ffprobe) need a real local file to operate on.
 * This is the one place the interface's local-disk origins show through;
 * documented rather than hidden.
 */
class S3StorageDriver extends StorageDriver {
  constructor({ bucket, region, accessKeyId, secretAccessKey, endpoint, forcePathStyle }) {
    super();
    this.bucket = bucket;
    this.client = new S3Client({
      region: region || 'auto',
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(forcePathStyle),
    });
  }

  async saveFromPath(key, sourcePath) {
    try {
      const upload = new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: key, Body: fs.createReadStream(sourcePath) },
      });
      await upload.done();
      return key;
    } catch (err) {
      metrics.increment('storage_error', { operation: 'saveFromPath', driver: 's3' });
      logger.error({ err: err.message, key }, 'storage: s3 saveFromPath failed');
      throw err;
    }
  }

  async getReadStream(key) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return result.Body; // a Node.js Readable in the SDK v3 Node runtime
    } catch (err) {
      metrics.increment('storage_error', { operation: 'getReadStream', driver: 's3' });
      logger.error({ err: err.message, key }, 'storage: s3 getReadStream failed');
      throw err;
    }
  }

  /**
   * Downloads the object to a local temp file and returns that path —
   * needed because FFmpeg/ffprobe require a real filesystem path, not a
   * stream or URL. Callers are responsible for cleaning up the returned
   * temp path (same contract as local-disk callers already follow for
   * their own temp files).
   */
  async getAbsolutePath(key) {
    const os = require('os');
    const path = require('path');
    const fsp = require('fs/promises');
    const tmpPath = path.join(os.tmpdir(), `s3-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    const stream = await this.getReadStream(key);
    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(tmpPath);
      stream.pipe(dest);
      stream.on('error', reject);
      dest.on('error', reject);
      dest.on('finish', resolve);
    });
    // Confirms the temp file directory exists / write succeeded before
    // handing the path back (defensive — mirrors LocalDiskStorageDriver's
    // existence guarantees).
    await fsp.access(tmpPath);
    return tmpPath;
  }

  async exists(key) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  async delete(key) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      metrics.increment('storage_error', { operation: 'delete', driver: 's3' });
      logger.error({ err: err.message, key }, 'storage: s3 delete failed');
      throw err;
    }
  }

  async size(key) {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return result.ContentLength;
  }
}

module.exports = S3StorageDriver;
