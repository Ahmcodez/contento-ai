// Set before anything loads config: the AI queue's 5-calls/minute limiter would
// otherwise stall this run (a full pipeline makes 7 AI calls).
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

// The real incident this guards against: the job row says "in progress" but the
// queue job is gone (Redis flush, or a crash between a state change and the next
// enqueue). Nothing would ever move it again. Here real workers + real ffmpeg
// carry a job whose queue job was lost all the way to COMPLETED, driven only by
// the reaper.
describe('stuck job reaper recovers a real pipeline run (e2e)', () => {
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

  it('completes a job whose very first queue job was lost', async () => {
    const authService = require('../src/services/auth.service');
    const mediaService = require('../src/services/media.service');
    const { PHYSICAL_QUEUES, getPhysicalQueue } = require('../src/queue/queues');
    const reaper = require('../src/workers/stuckJobReaper');

    const { user } = await authService.register({ email: `reaper-e2e-${Date.now()}@example.com`, password: 'password123', name: 'R' });
    const workspace = await db('workspaces').where({ owner_id: user.id }).first();
    const [project] = await db('projects').insert({ workspace_id: workspace.id, title: 'reaper e2e', created_by: user.id }).returning('*');

    const buf = await fs.readFile(FIXTURE);
    const tmp = path.join(config.storage.tmpPath, `reaper-e2e-${Date.now()}.mp4`);
    await fs.mkdir(config.storage.tmpPath, { recursive: true });
    await fs.writeFile(tmp, buf);
    const { processingJob } = await mediaService.uploadMedia(user.id, project.id, { path: tmp, originalname: 'sample.mp4', size: buf.length });

    // Lose the queue job exactly as a Redis flush would, while the row says UPLOADED.
    await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).obliterate({ force: true });
    await db('processing_jobs').where({ id: processingJob.id }).update({ updated_at: new Date(Date.now() - 10 * 60 * 1000) });
    expect(await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).getJobCounts('waiting', 'active', 'delayed')).toMatchObject({ waiting: 0, active: 0, delayed: 0 });

    // Without workers running, nothing moves it: that is the bug.
    await sleep(300);
    expect((await db('processing_jobs').where({ id: processingJob.id }).first()).state).toBe('UPLOADED');

    const result = await reaper.sweep();
    expect(result.requeued).toBe(1);

    workers = require('../src/workers').startWorkers();

    let state;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      state = (await db('processing_jobs').where({ id: processingJob.id }).first()).state;
      if (['COMPLETED', 'FAILED'].includes(state)) break;
      await sleep(500);
    }

    expect(state).toBe('COMPLETED');
    expect(await db('clip_candidates').where({ processing_job_id: processingJob.id })).toHaveLength(1);
    expect((await db('generated_content').where({ processing_job_id: processingJob.id })).length).toBeGreaterThan(0);
  }, 120000);
});
