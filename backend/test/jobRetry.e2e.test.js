// A full pipeline makes 7 AI calls; keep the 5/minute limiter from stalling this run.
process.env.QUEUE_AI_RATE_LIMIT_MAX = '1000';

const path = require('path');
const fs = require('fs/promises');
const db = require('../src/db/client');
const config = require('../src/config');
const { installMockProviders, removeMockProviders } = require('./helpers/mockProviders');
const { resetAiQueueState } = require('./helpers/queueState');

jest.mock('../src/ai', () => ({ getAIProvider: () => global.__mockAIProvider }));
jest.mock('../src/transcription', () => ({ getTranscriptionProvider: () => global.__mockTranscriptionProvider }));

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForState(jobId, accept, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
     
    state = (await db('processing_jobs').where({ id: jobId }).first()).state;
    if (accept.includes(state)) return state;
     
    await sleep(300);
  }
  return state;
}

// The user-visible scenario: the transcription provider is down/misconfigured so
// the job fails; the provider gets fixed; the user clicks Retry. It must resume
// at transcription (not redo upload/validation/audio extraction) and finish.
describe('job retry resumes a really-failed pipeline run (e2e)', () => {
  let workers;

  beforeAll(async () => {
    await resetDb();
    await resetAiQueueState();
    installMockProviders();
  });

  afterAll(async () => {
    if (workers) await require('../src/workers').stopWorkers(workers);
    await resetAiQueueState(); // don't leave a spent rate-limit budget for the next test file
    await require('../src/queue/queues').closeAllQueues();
    removeMockProviders();
  });

  it('fails at transcription, then completes after retry', async () => {
    const { TranscriptionProviderError } = require('../src/transcription/TranscriptionProvider');
    const authService = require('../src/services/auth.service');
    const mediaService = require('../src/services/media.service');
    const jobService = require('../src/services/job.service');

    const { user } = await authService.register({ email: `retry-e2e-${Date.now()}@example.com`, password: 'password123', name: 'R' });
    const workspace = await db('workspaces').where({ owner_id: user.id }).first();
    const [project] = await db('projects').insert({ workspace_id: workspace.id, title: 'retry e2e', created_by: user.id }).returning('*');

    // Provider is broken: a non-retryable error fails the job cleanly, like a bad API key would.
    const good = global.__mockTranscriptionProvider.transcribe.getMockImplementation();
    global.__mockTranscriptionProvider.transcribe.mockRejectedValue(
      new TranscriptionProviderError('Transcription provider rejected the API key', { retryable: false, reason: 'auth' }),
    );

    workers = require('../src/workers').startWorkers();

    const buf = await fs.readFile(FIXTURE);
    const tmp = path.join(config.storage.tmpPath, `retry-e2e-${Date.now()}.mp4`);
    await fs.mkdir(config.storage.tmpPath, { recursive: true });
    await fs.writeFile(tmp, buf);
    const { processingJob } = await mediaService.uploadMedia(user.id, project.id, { path: tmp, originalname: 'sample.mp4', size: buf.length });

    expect(await waitForState(processingJob.id, ['FAILED', 'COMPLETED'])).toBe('FAILED');
    const failed = await jobService.getJob(user.id, processingJob.id);
    expect(failed.failureStage).toBe('TRANSCRIBING');
    expect(failed.errorMessage).toContain('API key');
    const audioExtractionsBefore = (await db('processing_job_events').where({ processing_job_id: processingJob.id, to_state: 'EXTRACTING_AUDIO' })).length;

    // Provider fixed, user retries.
    global.__mockTranscriptionProvider.transcribe.mockImplementation(good);
    const retried = await jobService.retryJob(user.id, processingJob.id);
    expect(retried.state).toBe('TRANSCRIBING');

    expect(await waitForState(processingJob.id, ['FAILED', 'COMPLETED'])).toBe('COMPLETED');
    expect(await db('clip_candidates').where({ processing_job_id: processingJob.id })).toHaveLength(1);
    expect((await db('generated_content').where({ processing_job_id: processingJob.id })).length).toBeGreaterThan(0);

    // Resumed, not restarted: earlier stages did not run a second time.
    const audioExtractionsAfter = (await db('processing_job_events').where({ processing_job_id: processingJob.id, to_state: 'EXTRACTING_AUDIO' })).length;
    expect(audioExtractionsAfter).toBe(audioExtractionsBefore);
    const done = await jobService.getJob(user.id, processingJob.id);
    expect(done).toMatchObject({ state: 'COMPLETED', errorMessage: null, failureStage: null });
  }, 150000);
});
