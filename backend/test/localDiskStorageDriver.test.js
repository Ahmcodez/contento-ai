const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const LocalDiskStorageDriver = require('../src/storage/LocalDiskStorageDriver');

describe('LocalDiskStorageDriver', () => {
  let root;
  let driver;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'contento-storage-test-'));
    driver = new LocalDiskStorageDriver(root);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  describe('saveFromPath', () => {
    it('copies a real file into the storage root under the given key, creating nested dirs', async () => {
      const src = path.join(root, '..', `src-${Date.now()}.bin`);
      await fsp.writeFile(src, 'hello world');

      const key = 'workspace-1/project-1/asset.bin';
      const returnedKey = await driver.saveFromPath(key, src);

      expect(returnedKey).toBe(key);
      const savedContent = await fsp.readFile(path.join(root, key), 'utf8');
      expect(savedContent).toBe('hello world');

      await fsp.rm(src, { force: true });
    });

    it('propagates a real failure when the source file does not exist', async () => {
      await expect(
        driver.saveFromPath('some/key.bin', path.join(root, '..', 'does-not-exist.bin')),
      ).rejects.toThrow();
    });
  });

  describe('exists', () => {
    it('returns true for a file that was actually written', async () => {
      await fsp.mkdir(path.join(root, 'p'), { recursive: true });
      await fsp.writeFile(path.join(root, 'p', 'f.bin'), 'x');
      await expect(driver.exists('p/f.bin')).resolves.toBe(true);
    });

    it('returns false for a key that was never written, rather than throwing', async () => {
      await expect(driver.exists('nope/nothing.bin')).resolves.toBe(false);
    });
  });

  describe('size', () => {
    it('returns the real byte size of a written file', async () => {
      await fsp.mkdir(path.join(root, 'p'), { recursive: true });
      await fsp.writeFile(path.join(root, 'p', 'f.bin'), Buffer.alloc(1234));
      await expect(driver.size('p/f.bin')).resolves.toBe(1234);
    });

    it('throws (does not silently return 0/undefined) for a missing file', async () => {
      await expect(driver.size('missing/file.bin')).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('removes a file that exists', async () => {
      await fsp.mkdir(path.join(root, 'p'), { recursive: true });
      await fsp.writeFile(path.join(root, 'p', 'f.bin'), 'x');
      await driver.delete('p/f.bin');
      await expect(driver.exists('p/f.bin')).resolves.toBe(false);
    });

    it('does not throw when deleting a key that was never written (idempotent)', async () => {
      await expect(driver.delete('never/existed.bin')).resolves.toBeUndefined();
    });
  });

  describe('getReadStream / getAbsolutePath', () => {
    it('streams back exactly what was written', async () => {
      await fsp.mkdir(path.join(root, 'p'), { recursive: true });
      await fsp.writeFile(path.join(root, 'p', 'f.bin'), 'streamed content');

      const stream = await driver.getReadStream('p/f.bin');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString('utf8')).toBe('streamed content');
    });

    it('getAbsolutePath resolves to a real path inside the storage root', async () => {
      const abs = await driver.getAbsolutePath('p/f.bin');
      expect(abs).toBe(path.join(root, 'p', 'f.bin'));
      expect(abs.startsWith(root)).toBe(true);
    });
  });

  describe('path traversal defense', () => {
    // Storage keys are always server-generated (ulid-based), never taken
    // directly from client input — but this guard is what stands between
    // a bug elsewhere in the app and a real path-traversal read/write/
    // delete outside the storage root, so it's worth verifying directly
    // rather than trusting that upstream code never gets it wrong.
    it('rejects a key that would resolve outside the storage root via ../ segments', async () => {
      await expect(driver.exists('../../../etc/passwd')).resolves.toBe(false);
      // exists() swallows the resolveKey throw into `false` by design (see
      // its try/catch), so assert the throw directly via a method that
      // doesn't catch it, to prove resolveKey itself actually rejects this.
      expect(() => driver.resolveKey('../../../etc/passwd')).toThrow(/outside storage root/);
    });

    it('rejects an absolute path used as a key', () => {
      expect(() => driver.resolveKey('/etc/passwd')).toThrow(/outside storage root/);
    });

    it('accepts a normal nested key with no traversal', () => {
      expect(() => driver.resolveKey('workspace/project/asset.mp4')).not.toThrow();
    });
  });
});
