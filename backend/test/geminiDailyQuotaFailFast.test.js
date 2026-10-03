const path = require('path');
const fs = require('fs/promises');
const db = require('../src/db/client');
const config = require('../src/config');
const { AIProviderError } = require('../src/ai/AIProvider');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.mp4');

// Real incident: a worker log showed a daily-quota 429 (not the earlier
// per-minute one) triggering 2 extra retries, a 127-second stall, and a
// confusing unrelated 503 as the final error — instead of failing
// immediately with an honest message. This test proves the fix through
// the REAL processor and REAL database, not just the provider in
// isolation (test/geminiProvider.test.js already covers that).
//
// This mocks getAIProvider() directly rather than using a real
// GeminiProvider, so it represents the state AFTER GeminiProvider's own
// one-hop daily-quota fallback (see geminiProvider.test.js's "falls back
// to GEMINI_FALLBACK_MODEL" suite) has already been exhausted — i.e. both
// the primary and fallback models are out of daily quota. Even in that
// case, the processor must still fail fast rather than retry.
jest.mock('../src/ai', () => ({
  getAIProvider: () => global.__mockAIProvider,
}));
jest.mock('../src/transcription', () => ({
  getTranscriptionProvider: () => global.__mockTranscriptionProvider,
}));

describe('a Gemini daily-quota failure fails the job fast, with no retry (real DB + real ffmpeg)', () => {
  let processingJobId;
  let mediaAssetId;

  beforeAll(async () => {
    await resetDb();

    global.__mockTranscriptionProvider = {
      transcribe: jest.fn().mockResolvedValue({
        fullText: 'A short transcript for the daily quota fail-fast test.',
        language: 'en',
        segments: [{ startMs: 0, endMs: 2000, text: 'A short transcript for the daily quota fail-fast test.' }],
      }),
    };

    global.__mockAIProvider = {
      constructor: { name: 'MockAIProvider' },
      generateStructuredOutput: jest.fn().mockRejectedValue(
        new AIProviderError(
          "Gemini's free-tier daily request limit has been reached for this project. This resets after a day — try again later, or enable billing on your Google AI Studio / Cloud project to raise the limit.",
          { retryable: false, reason: 'daily_quota_exceeded' },
        ),
      ),
    };

    const authService = require('../src/services/auth.service');
    const { user } = await authService.register({
      email: `daily-quota-${Date.now()}@example.com`,
      password: 'password123',
      name: 'Quota Test',
    });
    const workspace = await db('workspaces').where({ owner_id: user.id }).first();
    const [project] = await db('projects')
      .insert({ workspace_id: workspace.id, title: 'daily quota test', created_by: user.id })
      .returning('*');

    const mediaService = require('../src/services/media.service');
    const fileBuffer = await fs.readFile(FIXTURE);
    const tmpPath = path.join(config.storage.tmpPath, `daily-quota-${Date.now()}.mp4`);
    await fs.mkdir(config.storage.tmpPath, { recursive: true });
    await fs.writeFile(tmpPath, fileBuffer);
    const { mediaAsset, processingJob } = await mediaService.uploadMedia(user.id, project.id, {
      path: tmpPath,
      originalname: 'sample.mp4',
      size: fileBuffer.length,
    });
    mediaAssetId = mediaAsset.id;
    processingJobId = processingJob.id;

    const processVideoValidate = require('../src/workers/processors/videoValidate.processor');
    await processVideoValidate({ data: { processingJobId, mediaAssetId } });
    const processAudioExtract = require('../src/workers/processors/audioExtract.processor');
    await processAudioExtract({ data: { processingJobId, mediaAssetId } });
    const processTranscription = require('../src/workers/processors/transcriptionProcess.processor');
    const asset = await db('media_assets').where({ id: mediaAssetId }).first();
    const audioStorageKey = asset.storage_key.replace(path.extname(asset.storage_key), '.audio.wav');
    await processTranscription({ data: { processingJobId, mediaAssetId, audioStorageKey } });

    const readyJob = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(readyJob.state).toBe('TRANSCRIBED'); // sanity check before the real assertion below
  }, 60000);

  afterAll(async () => {
    const { closeAllQueues } = require('../src/queue/queues');
    await closeAllQueues();
    delete global.__mockAIProvider;
    delete global.__mockTranscriptionProvider;
  });

  it('fails the job on the first attempt — no retry, no multi-second wait, no masked secondary error', async () => {
    const processContentAnalyze = require('../src/workers/processors/contentAnalyze.processor');

    const t0 = Date.now();
    await expect(processContentAnalyze({ data: { processingJobId, mediaAssetId } })).resolves.toBeUndefined();
    const elapsedMs = Date.now() - t0;

    // The real bug: a non-retryable error still waited a 58s RetryInfo
    // delay and burned extra attempts before failing. Fixed behavior
    // fails on the very first call.
    expect(elapsedMs).toBeLessThan(2000);
    expect(global.__mockAIProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('FAILED');
    expect(job.failure_stage).toBe('ANALYZING');
    expect(job.error_message).toContain('daily request limit');
    // not the confusing unrelated secondary error a real user saw
    expect(job.error_message).not.toContain('high demand');
    expect(job.error_message).not.toContain('503');
  });
});
