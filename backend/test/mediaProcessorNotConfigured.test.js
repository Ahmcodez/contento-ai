const path = require('path');
const config = require('../src/config');
const mediaProcessor = require('../src/media/MediaProcessor');
const db = require('../src/db/client');
const request = require('supertest');
const createApp = require('../src/app');
const processVideoValidate = require('../src/workers/processors/videoValidate.processor');
const processAudioExtract = require('../src/workers/processors/audioExtract.processor');

const app = createApp();
const FIXTURE = path.join(__dirname, 'fixtures', 'sample.mp4');

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token) {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'ffmpeg-missing test' });
  return res.body.project;
}

async function createMediaAsset(project, userId, { storageKey }) {
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: userId,
      original_filename: 'sample.mp4',
      storage_key: storageKey,
      mime_type: 'video/mp4',
      size_bytes: 1024,
      checksum_sha256: `checksum-${Date.now()}-${Math.random()}`,
      status: 'uploaded',
    })
    .returning('*');
  return asset;
}

async function createJob(asset, state) {
  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state }).returning('*');
  return job;
}

/**
 * Regression coverage for the ffmpeg/ffprobe-missing bug diagnosed live:
 * a video-validate (or audio-extract) job stalled/failed with a bare
 * "spawn ffprobe ENOENT" and, after RETRY_CONFIG's attempts were
 * exhausted, surfaced only the generic "Processing failed after multiple
 * attempts" message — no indication ffmpeg simply wasn't installed.
 * These tests lock in: (1) MediaProcessor classifies ENOENT as a clean,
 * non-retryable MediaProcessorError, and (2) both processors catch it and
 * fail the job immediately with that specific message, rather than
 * retrying a problem retries can't fix.
 */
describe('ffmpeg/ffprobe not installed — fail-fast behavior', () => {
  let originalFfmpegPath;
  let originalFfprobePath;

  beforeEach(async () => {
    await resetDb();
    originalFfmpegPath = config.ffmpeg.ffmpegPath;
    originalFfprobePath = config.ffmpeg.ffprobePath;
    config.ffmpeg.ffmpegPath = 'definitely-not-a-real-binary-xyz';
    config.ffmpeg.ffprobePath = 'definitely-not-a-real-binary-xyz';
  });

  afterEach(() => {
    config.ffmpeg.ffmpegPath = originalFfmpegPath;
    config.ffmpeg.ffprobePath = originalFfprobePath;
  });

  describe('MediaProcessor', () => {
    it('probe() throws a non-retryable MediaProcessorError when ffprobe is missing', async () => {
      await expect(mediaProcessor.probe(FIXTURE)).rejects.toMatchObject({
        name: 'MediaProcessorError',
        retryable: false,
        reason: 'not_configured',
      });
    });

    it('extractAudio() throws a non-retryable MediaProcessorError when ffmpeg is missing', async () => {
      await expect(mediaProcessor.extractAudio(FIXTURE, '/tmp/whatever.wav')).rejects.toMatchObject({
        name: 'MediaProcessorError',
        retryable: false,
        reason: 'not_configured',
      });
    });

    it('error message names the missing binary and points at FFMPEG_PATH/FFPROBE_PATH', async () => {
      await expect(mediaProcessor.probe(FIXTURE)).rejects.toThrow(/not installed or not on PATH/);
      await expect(mediaProcessor.probe(FIXTURE)).rejects.toThrow(/FFMPEG_PATH|FFPROBE_PATH/);
    });
  });

  describe('videoValidate.processor', () => {
    it('fails the job immediately with a specific message instead of throwing/retrying', async () => {
      const { token, userId } = await registerUser('ffmpeg-missing-validate@example.com');
      const project = await createProject(token);
      const asset = await createMediaAsset(project, userId, { storageKey: `${project.workspace_id}/${project.id}/sample.mp4` });
      const job = await createJob(asset, 'UPLOADED');

      // The real StorageDriver.getAbsolutePath just resolves against
      // STORAGE_LOCAL_PATH; point storage_key at the real fixture file
      // relative to that so probe() gets a real path (it never reaches
      // ffprobe anyway, but this keeps the setup honest).
      await db('media_assets').where({ id: asset.id }).update({ storage_key: 'sample.mp4' });
      const fs = require('fs/promises');
      await fs.mkdir(config.storage.localPath, { recursive: true });
      await fs.copyFile(FIXTURE, path.join(config.storage.localPath, 'sample.mp4'));

      await expect(processVideoValidate({ data: { processingJobId: job.id, mediaAssetId: asset.id } })).resolves.toBeUndefined();

      const updatedJob = await db('processing_jobs').where({ id: job.id }).first();
      expect(updatedJob.state).toBe('FAILED');
      expect(updatedJob.failure_stage).toBe('VALIDATING');
      expect(updatedJob.error_message).toMatch(/not installed or not on PATH/);

      const updatedAsset = await db('media_assets').where({ id: asset.id }).first();
      expect(updatedAsset.status).toBe('rejected');
    });
  });

  describe('audioExtract.processor', () => {
    it('fails the job immediately with a specific message instead of throwing/retrying', async () => {
      const { token, userId } = await registerUser('ffmpeg-missing-extract@example.com');
      const project = await createProject(token);
      const asset = await createMediaAsset(project, userId, { storageKey: 'sample.mp4' });
      await db('media_assets').where({ id: asset.id }).update({ status: 'validated', duration_seconds: 4 });
      const job = await createJob(asset, 'VALIDATED');

      const fs = require('fs/promises');
      await fs.mkdir(config.storage.localPath, { recursive: true });
      await fs.copyFile(FIXTURE, path.join(config.storage.localPath, 'sample.mp4'));

      await expect(processAudioExtract({ data: { processingJobId: job.id, mediaAssetId: asset.id } })).resolves.toBeUndefined();

      const updatedJob = await db('processing_jobs').where({ id: job.id }).first();
      expect(updatedJob.state).toBe('FAILED');
      expect(updatedJob.failure_stage).toBe('EXTRACTING_AUDIO');
      expect(updatedJob.error_message).toMatch(/not installed or not on PATH/);
    });
  });
});
