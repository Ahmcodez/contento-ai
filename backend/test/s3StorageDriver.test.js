jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  };
});

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn(),
}));

const { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { Readable } = require('stream');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const S3StorageDriver = require('../src/storage/S3StorageDriver');

describe('S3StorageDriver', () => {
  let driver;
  let mockSend;

  beforeEach(() => {
    jest.clearAllMocks();
    driver = new S3StorageDriver({ bucket: 'test-bucket', region: 'us-east-1' });
    mockSend = driver.client.send;
  });

  it('constructs an S3Client scoped to the configured bucket', () => {
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
  });

  describe('exists', () => {
    it('returns true when HeadObject succeeds', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await driver.exists('some-key');
      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('returns false when the object is not found', async () => {
      const notFoundError = new Error('not found');
      notFoundError.name = 'NotFound';
      mockSend.mockRejectedValueOnce(notFoundError);
      const result = await driver.exists('missing-key');
      expect(result).toBe(false);
    });

    it('rethrows a genuine error (not a 404)', async () => {
      mockSend.mockRejectedValueOnce(new Error('access denied'));
      await expect(driver.exists('some-key')).rejects.toThrow('access denied');
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand for the given key', async () => {
      mockSend.mockResolvedValueOnce({});
      await driver.delete('some-key');
      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });

    it('propagates a failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('network error'));
      await expect(driver.delete('some-key')).rejects.toThrow('network error');
    });
  });

  describe('size', () => {
    it('returns ContentLength from HeadObject', async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 12345 });
      const result = await driver.size('some-key');
      expect(result).toBe(12345);
    });
  });

  describe('getReadStream', () => {
    it('returns the Body stream from GetObject', async () => {
      const fakeStream = Readable.from(['hello']);
      mockSend.mockResolvedValueOnce({ Body: fakeStream });
      const stream = await driver.getReadStream('some-key');
      expect(stream).toBe(fakeStream);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('propagates a failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('access denied'));
      await expect(driver.getReadStream('some-key')).rejects.toThrow('access denied');
    });
  });

  describe('saveFromPath', () => {
    it('uploads via the Upload helper and returns the key', async () => {
      const fakeUploadInstance = { done: jest.fn().mockResolvedValue({}) };
      Upload.mockImplementation(() => fakeUploadInstance);

      const tmpFile = path.join(os.tmpdir(), `s3-test-${Date.now()}.txt`);
      await fs.writeFile(tmpFile, 'content');

      const result = await driver.saveFromPath('dest-key', tmpFile);
      expect(result).toBe('dest-key');
      expect(fakeUploadInstance.done).toHaveBeenCalled();

      await fs.rm(tmpFile, { force: true });
    });

    it('propagates an upload failure', async () => {
      const fakeUploadInstance = { done: jest.fn().mockRejectedValue(new Error('upload failed')) };
      Upload.mockImplementation(() => fakeUploadInstance);

      const tmpFile = path.join(os.tmpdir(), `s3-test-fail-${Date.now()}.txt`);
      await fs.writeFile(tmpFile, 'content');

      await expect(driver.saveFromPath('dest-key', tmpFile)).rejects.toThrow('upload failed');
      await fs.rm(tmpFile, { force: true });
    });
  });

  describe('getAbsolutePath', () => {
    it('downloads the object to a real local temp file', async () => {
      const fakeStream = Readable.from(['hello world']);
      mockSend.mockResolvedValueOnce({ Body: fakeStream });

      const tmpPath = await driver.getAbsolutePath('some-key');
      const content = await fs.readFile(tmpPath, 'utf-8');
      expect(content).toBe('hello world');

      await fs.rm(tmpPath, { force: true });
    });
  });
});
