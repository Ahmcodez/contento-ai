const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const db = require('../src/db/client');
const redis = require('../src/redis/client');
const config = require('../src/config');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.mp4');

// The AI and transcription providers are the only mocked boundary here —
// everything else (DB, ffmpeg, caption generation, storage, scoring,
// state machine) is real. This is the only honest way to run this
// pipeline end to end without a live Gemini API key.
jest.mock('../src/ai', () => ({
  getAIProvider: () => global.__mockAIProvider,
}));
jest.mock('../src/transcription', () => ({
  getTranscriptionProvider: () => global.__mockTranscriptionProvider,
}));

describe('full content pipeline (e2e)', () => {
  let userId;
  let projectId;
  let mediaAssetId;
  let processingJobId;
  let workspaceId;

  beforeAll(async () => {
    await resetDb();

    global.__mockTranscriptionProvider = {
      transcribe: jest.fn().mockResolvedValue({
        fullText: 'Welcome to the show. Today I want to tell you a surprising story about my first startup failing. It taught me that persistence matters more than raw talent. And that is the key lesson for anyone starting out.',
        language: 'en',
        segments: [
          { startMs: 0, endMs: 2000, text: 'Welcome to the show.' },
          { startMs: 2000, endMs: 6000, text: 'Today I want to tell you a surprising story about my first startup failing.' },
          { startMs: 6000, endMs: 9000, text: 'It taught me that persistence matters more than raw talent.' },
          { startMs: 9000, endMs: 12000, text: 'And that is the key lesson for anyone starting out.' },
        ],
      }),
    };

    global.__mockAIProvider = {
      constructor: { name: 'MockAIProvider' },
      generateStructuredOutput: jest.fn(async ({ prompt }) => {
        if (prompt.includes('clip moments')) {
          return {
            data: {
              clips: [
                {
                  startMs: 2000,
                  endMs: 9000,
                  title: 'From startup failure to hard-won lesson',
                  hook: 'My first startup failed — here is what it taught me',
                  summary: 'A short story about startup failure and the lesson learned from it.',
                  reason: 'Complete narrative arc with a clear takeaway',
                  topic: 'entrepreneurship',
                  estimatedQualityScore: 82,
                },
              ],
            },
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        }
        // content analysis call
        return {
          data: {
            summary: 'The speaker shares a personal story about their first startup failing and the lesson of persistence.',
            topics: ['entrepreneurship', 'failure', 'persistence'],
            keyPoints: [{ text: 'Persistence matters more than raw talent', startMs: 6000, endMs: 9000 }],
            stories: [{ text: 'First startup failing', startMs: 2000, endMs: 6000 }],
            strongOpinions: [],
            educationalMoments: [{ text: 'Persistence matters more than raw talent', startMs: 6000, endMs: 9000 }],
            surprisingStatements: [{ text: 'a surprising story about my first startup failing', startMs: 2000, endMs: 6000 }],
            questions: [],
            conclusions: [{ text: 'that is the key lesson for anyone starting out', startMs: 9000, endMs: 12000 }],
            memorableQuotes: [{ text: 'persistence matters more than raw talent', startMs: 6000, endMs: 9000 }],
            selfContainedIdeas: [{ text: 'persistence matters more than raw talent', startMs: 6000, endMs: 9000 }],
          },
          usage: { inputTokens: 80, outputTokens: 60 },
        };
      }),
      generateText: jest.fn(async ({ prompt }) => {
        const type = prompt.includes('X/Twitter') ? 'x_twitter' : 'generic';
        const text = type === 'x_twitter'
          ? 'My first startup failed. Persistence beats raw talent every time.'
          : 'A grounded piece of written content generated from the transcript, discussing the startup failure story and the persistence lesson learned from it.';
        return { text, usage: { inputTokens: 40, outputTokens: 40 } };
      }),
    };
  });

  afterAll(async () => {
    const { QUEUE_NAMES, getQueue } = require('../src/queue/queues');
    await Promise.all(Object.values(QUEUE_NAMES).map((name) => getQueue(name).close()));
    delete global.__mockAIProvider;
    delete global.__mockTranscriptionProvider;
    // db.destroy() and redis.quit() are handled once by test/setup.js's
    // shared afterAll — calling them again here would double-close the
    // same connections.
  });

  it('sets up a user, workspace and project', async () => {
    const authService = require('../src/services/auth.service');
    const { user } = await authService.register({ email: `e2e-${Date.now()}@example.com`, password: 'password123', name: 'E2E' });
    userId = user.id;

    const workspace = await db('workspaces').where({ owner_id: userId }).first();
    workspaceId = workspace.id;

    const [project] = await db('projects')
      .insert({ workspace_id: workspaceId, title: 'E2E pipeline test', created_by: userId })
      .returning('*');
    projectId = project.id;

    expect(project.id).toBeDefined();
  });

  it('uploads the sample video and creates a processing job', async () => {
    const mediaService = require('../src/services/media.service');
    const fileBuffer = await fs.readFile(FIXTURE);
    const tmpPath = path.join(config.storage.tmpPath, `e2e-${Date.now()}.mp4`);
    await fs.mkdir(config.storage.tmpPath, { recursive: true });
    await fs.writeFile(tmpPath, fileBuffer);

    const { mediaAsset, processingJob } = await mediaService.uploadMedia(userId, projectId, {
      path: tmpPath,
      originalname: 'sample.mp4',
      size: fileBuffer.length,
    });

    mediaAssetId = mediaAsset.id;
    processingJobId = processingJob.id;

    expect(mediaAsset.status).toBe('uploaded');
    expect(processingJob.state).toBe('UPLOADED');
  });

  it('runs video.validate for real (real ffprobe)', async () => {
    const processVideoValidate = require('../src/workers/processors/videoValidate.processor');
    await processVideoValidate({ data: { processingJobId, mediaAssetId } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('VALIDATED');

    const asset = await db('media_assets').where({ id: mediaAssetId }).first();
    expect(Number(asset.duration_seconds)).toBeCloseTo(4, 0);
  });

  it('runs audio.extract for real (real ffmpeg)', async () => {
    const processAudioExtract = require('../src/workers/processors/audioExtract.processor');
    await processAudioExtract({ data: { processingJobId, mediaAssetId } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('AUDIO_EXTRACTED');
  });

  it('runs transcription.process and persists real transcript rows', async () => {
    const asset = await db('media_assets').where({ id: mediaAssetId }).first();
    const audioStorageKey = asset.storage_key.replace(path.extname(asset.storage_key), '.audio.wav');

    const processTranscription = require('../src/workers/processors/transcriptionProcess.processor');
    await processTranscription({ data: { processingJobId, mediaAssetId, audioStorageKey } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('TRANSCRIBED');

    const transcript = await db('transcripts').where({ media_asset_id: mediaAssetId }).first();
    expect(transcript).toBeDefined();
    expect(transcript.full_text).toContain('startup');

    const segments = await db('transcript_segments').where({ transcript_id: transcript.id });
    expect(segments.length).toBe(4);
  });

  it('runs content.analyze and persists a real analysis row', async () => {
    const processContentAnalyze = require('../src/workers/processors/contentAnalyze.processor');
    await processContentAnalyze({ data: { processingJobId, mediaAssetId } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('ANALYZED');

    const analysis = await db('content_analyses').where({ processing_job_id: processingJobId }).first();
    expect(analysis).toBeDefined();
    expect(analysis.topics).toEqual(expect.arrayContaining(['entrepreneurship']));
  });

  it('runs clips.detect and persists scored clip candidates', async () => {
    const processClipsDetect = require('../src/workers/processors/clipsDetect.processor');
    await processClipsDetect({ data: { processingJobId, mediaAssetId } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('CLIPS_SCORED');

    const candidates = await db('clip_candidates').where({ processing_job_id: processingJobId });
    expect(candidates.length).toBeGreaterThan(0);
    expect(Number(candidates[0].final_score)).toBeGreaterThan(0);
    expect(candidates[0].end_ms).toBeGreaterThan(candidates[0].start_ms);
  }, 20000);

  it('runs clip.render and produces a real rendered clip file with captions and thumbnail', async () => {
    const candidates = await db('clip_candidates').where({ processing_job_id: processingJobId });
    const processClipRender = require('../src/workers/processors/clipRender.processor');
    await processClipRender({
      data: { processingJobId, mediaAssetId, clipCandidateIds: candidates.map((c) => c.id) },
    });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('CLIPS_RENDERED');

    const generatedClip = await db('generated_clips').where({ clip_candidate_id: candidates[0].id }).first();
    expect(generatedClip.render_status).toBe('rendered');
    expect(generatedClip.storage_key).toBeDefined();
    expect(Number(generatedClip.duration_seconds)).toBeGreaterThan(0);

    const storageDriver = require('../src/storage').getStorageDriver();
    const clipExists = await storageDriver.exists(generatedClip.storage_key);
    expect(clipExists).toBe(true);
    const thumbExists = await storageDriver.exists(generatedClip.thumbnail_storage_key);
    expect(thumbExists).toBe(true);

    // Verify the rendered clip is genuinely valid media, not a stub file.
    const mediaProcessor = require('../src/media/MediaProcessor');
    const absPath = await storageDriver.getAbsolutePath(generatedClip.storage_key);
    const validated = await mediaProcessor.validateOutput(absPath);
    expect(validated.durationSeconds).toBeGreaterThan(0);
  }, 30000);

  it('runs content.generate and persists real grounded written content', async () => {
    const processContentGenerate = require('../src/workers/processors/contentGenerate.processor');
    await processContentGenerate({ data: { processingJobId, mediaAssetId } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('CONTENT_GENERATED');

    const content = await db('generated_content').where({ processing_job_id: processingJobId });
    expect(content.length).toBe(5);
    const twitterPost = content.find((c) => c.content_type === 'x_twitter');
    expect(twitterPost.body.length).toBeLessThanOrEqual(280);
  }, 20000);

  it('runs job.finalize and completes the pipeline', async () => {
    const processJobFinalize = require('../src/workers/processors/jobFinalize.processor');
    await processJobFinalize({ data: { processingJobId, mediaAssetId } });

    const job = await db('processing_jobs').where({ id: processingJobId }).first();
    expect(job.state).toBe('COMPLETED');
    expect(job.progress_percent).toBe(100);
    expect(job.completed_at).not.toBeNull();
  });

  it('recorded ai usage for every real AI call made during the run', async () => {
    const usage = await db('usage_records').where({ user_id: userId, category: 'ai_requests' });
    expect(usage.length).toBeGreaterThan(0);
  });

  it('recorded a full, ordered state transition history', async () => {
    const events = await db('processing_job_events')
      .where({ processing_job_id: processingJobId })
      .orderBy('created_at', 'asc');

    const states = events.map((e) => e.to_state);
    expect(states).toEqual([
      'UPLOADED',
      'VALIDATING',
      'VALIDATED',
      'EXTRACTING_AUDIO',
      'AUDIO_EXTRACTED',
      'TRANSCRIBING',
      'TRANSCRIBED',
      'ANALYZING',
      'ANALYZED',
      'FINDING_CLIPS',
      'CLIPS_FOUND',
      'CLIPS_SCORED',
      'RENDERING_CLIPS',
      'CLIPS_RENDERED',
      'GENERATING_CONTENT',
      'CONTENT_GENERATED',
      'COMPLETED',
    ]);
  });
});
