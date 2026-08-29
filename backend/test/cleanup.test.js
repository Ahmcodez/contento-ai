const fs = require('fs/promises');
const path = require('path');
const db = require('../src/db/client');
const config = require('../src/config');
const { cleanupExpiredRefreshTokens, cleanupOrphanedTempFiles } = require('../scripts/cleanup');

describe('cleanup script', () => {
  let user;

  beforeEach(async () => {
    await resetDb();
    [user] = await db('users').insert({ email: `cleanup-${Date.now()}@example.com`, password_hash: 'x' }).returning('*');
  });

  describe('cleanupExpiredRefreshTokens', () => {
    it('removes a token that is already expired', async () => {
      await db('refresh_tokens').insert({
        user_id: user.id,
        token_hash: `expired-${Date.now()}`,
        expires_at: new Date(Date.now() - 1000),
      });
      const deleted = await cleanupExpiredRefreshTokens();
      expect(deleted).toBeGreaterThanOrEqual(1);
      const remaining = await db('refresh_tokens').where({ user_id: user.id });
      expect(remaining).toHaveLength(0);
    });

    it('removes a token revoked well in the past', async () => {
      await db('refresh_tokens').insert({
        user_id: user.id,
        token_hash: `revoked-old-${Date.now()}`,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        revoked_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30), // 30 days ago
      });
      await cleanupExpiredRefreshTokens();
      const remaining = await db('refresh_tokens').where({ user_id: user.id });
      expect(remaining).toHaveLength(0);
    });

    it('keeps a valid, unexpired, unrevoked token', async () => {
      await db('refresh_tokens').insert({
        user_id: user.id,
        token_hash: `valid-${Date.now()}`,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });
      await cleanupExpiredRefreshTokens();
      const remaining = await db('refresh_tokens').where({ user_id: user.id });
      expect(remaining).toHaveLength(1);
    });

    it('keeps a token revoked recently (within the retention window)', async () => {
      await db('refresh_tokens').insert({
        user_id: user.id,
        token_hash: `revoked-recent-${Date.now()}`,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        revoked_at: new Date(), // just now
      });
      await cleanupExpiredRefreshTokens();
      const remaining = await db('refresh_tokens').where({ user_id: user.id });
      expect(remaining).toHaveLength(1);
    });
  });

  describe('cleanupOrphanedTempFiles', () => {
    const tmpDir = path.resolve(config.storage.tmpPath);

    it('removes an old file but keeps a fresh one', async () => {
      await fs.mkdir(tmpDir, { recursive: true });
      const oldFile = path.join(tmpDir, `old-${Date.now()}.tmp`);
      const freshFile = path.join(tmpDir, `fresh-${Date.now()}.tmp`);
      await fs.writeFile(oldFile, 'x');
      await fs.writeFile(freshFile, 'x');

      // Backdate the "old" file's mtime well past the cleanup threshold.
      const oldTime = new Date(Date.now() - 1000 * 60 * 60 * 24);
      await fs.utimes(oldFile, oldTime, oldTime);

      const removed = await cleanupOrphanedTempFiles();
      expect(removed).toBeGreaterThanOrEqual(1);

      await expect(fs.access(oldFile)).rejects.toThrow();
      await expect(fs.access(freshFile)).resolves.toBeUndefined();

      await fs.rm(freshFile, { force: true });
    });

    it('does not throw if the temp directory does not exist', async () => {
      const originalPath = config.storage.tmpPath;
      config.storage.tmpPath = '/tmp/definitely-does-not-exist-xyz-123';
      await expect(cleanupOrphanedTempFiles()).resolves.toBe(0);
      config.storage.tmpPath = originalPath;
    });
  });
});
