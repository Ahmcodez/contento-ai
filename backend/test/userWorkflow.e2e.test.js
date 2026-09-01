const request = require('supertest');
const path = require('path');

// This is the one test in the suite that walks the actual user journey
// through the real HTTP API end to end: register -> login -> create
// project -> upload a real video -> a real BullMQ Worker actually
// consumes the job from real Redis and drives it through every real
// pipeline stage (real ffmpeg/ffprobe, real DB writes, real storage) ->
// polling the real job-status endpoint like a browser would -> fetching
// transcript/clips/content via the real read endpoints -> downloading a
// real rendered clip file via the real download endpoint.
//
// test/pipeline.e2e.test.js, despite its name, calls processor functions
// directly — it's a deep integration test of how pipeline stages chain
// together, not a test of the HTTP-facing user workflow. Nothing in the
// existing suite exercised auth -> real queue dispatch -> a real running
// Worker -> polling -> download as one continuous path before this file.
//
// AI and transcription remain the one mocked boundary, for the same
// reason pipeline.e2e.test.js mocks them: there's no live Gemini key in
// this environment, and faking that boundary is the only honest way to
// exercise everything else for real.
jest.mock('../src/ai', () => ({
  getAIProvider: () => global.__e2eMockAIProvider,
}));
jest.mock('../src/transcription', () => ({
  getTranscriptionProvider: () => global.__e2eMockTranscriptionProvider,
}));

const createApp = require('../src/app');
const { startWorkers, stopWorkers } = require('../src/workers/index');
const { closeAllQueues } = require('../src/queue/queues');

const app = createApp();
const FIXTURE = path.join(__dirname, 'fixtures', 'sample.mp4');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('complete user workflow (real HTTP + real queue + real workers)', () => {
  let workers;

  beforeAll(async () => {
    await resetDb();

    global.__e2eMockTranscriptionProvider = {
      transcribe: jest.fn().mockResolvedValue({
        fullText: 'Welcome to the show. This is a short clip about persistence.',
        language: 'en',
        segments: [
          { startMs: 0, endMs: 2000, text: 'Welcome to the show.' },
          { startMs: 2000, endMs: 6000, text: 'This is a short clip about persistence.' },
        ],
      }),
    };

    global.__e2eMockAIProvider = {
      constructor: { name: 'MockAIProvider' },
      generateStructuredOutput: jest.fn(async ({ prompt }) => {
        if (prompt.includes('clip moments')) {
          return {
            data: {
              clips: [
                {
                  startMs: 500,
                  endMs: 3500,
                  title: 'A short clip',
                  hook: 'Watch this',
                  summary: 'A brief moment.',
                  reason: 'Complete thought',
                  topic: 'persistence',
                  estimatedQualityScore: 75,
                },
              ],
            },
            usage: { inputTokens: 10, outputTokens: 10 },
          };
        }
        return {
          data: { summary: 'A short talk about persistence.', topics: ['persistence'], keyPoints: [] },
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      }),
      generateText: jest.fn().mockResolvedValue({
        text: 'A short, honest post about persistence.',
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    };

    // Real Workers, consuming from the real queues this environment's
    // Redis backs — exactly what runs in production, just in-process
    // here instead of a separate worker container.
    workers = startWorkers();
  }, 20000);

  afterAll(async () => {
    await stopWorkers(workers || []);
    await closeAllQueues();
  }, 20000);

  it('walks the full journey: register -> login -> project -> upload -> processing -> transcript -> clips -> content -> download', async () => {
    // 1. Register (this is also today's "login", since register returns
    // a usable access token immediately).
    const email = `e2e-${Date.now()}@example.com`;
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' });
    expect(registerRes.status).toBe(201);
    const { accessToken } = registerRes.body;
    const auth = { Authorization: `Bearer ${accessToken}` };

    // 1b. Login also works with the same credentials (a real user
    // returning in a new session, not just the register-time token).
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
    expect(loginRes.status).toBe(200);

    // 2. Create a project.
    const projectRes = await request(app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ title: 'E2E workflow test' });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.project.id;

    // 3. Upload a real video. This is the real multer -> real magic-byte
    // sniff -> real checksum -> real storage write -> real DB insert ->
    // real BullMQ enqueue path, not a shortcut.
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set(auth)
      .attach('video', FIXTURE);
    expect(uploadRes.status).toBe(202);
    const jobId = uploadRes.body.processingJob.id;
    expect(jobId).toBeTruthy();

    // 4. Poll the real job-status endpoint, exactly like the frontend's
    // useJobStatus hook does, until the real Workers (started above)
    // have driven the job through every real pipeline stage.
    let job;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const statusRes = await request(app).get(`/api/v1/jobs/${jobId}`).set(auth);
      expect(statusRes.status).toBe(200);
      job = statusRes.body;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)) break;
      await sleep(500);
    }

    expect(job.state).toBe('COMPLETED');

    // 5. Transcript is real and fetchable.
    const transcriptRes = await request(app).get(`/api/v1/jobs/${jobId}/transcript`).set(auth);
    expect(transcriptRes.status).toBe(200);
    expect(transcriptRes.body.fullText).toContain('persistence');

    // 6. Clips were actually detected, scored, and rendered to a real file.
    const clipsRes = await request(app).get(`/api/v1/jobs/${jobId}/clips`).set(auth);
    expect(clipsRes.status).toBe(200);
    expect(clipsRes.body.data.length).toBeGreaterThan(0);
    const clip = clipsRes.body.data[0];
    expect(clip.render.status).toBe('rendered');
    expect(typeof clip.qualityScore).toBe('number');

    // 7. Written content was generated and grounded in the transcript.
    const contentRes = await request(app).get(`/api/v1/jobs/${jobId}/content`).set(auth);
    expect(contentRes.status).toBe(200);
    expect(contentRes.body.data.length).toBeGreaterThan(0);

    // 8. Download the actual rendered clip file — a real streamed MP4,
    // not a stub response.
    const downloadRes = await request(app).get(`/api/v1/clips/${clip.id}/download`).set(auth);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toBe('video/mp4');
    expect(downloadRes.body.length).toBeGreaterThan(0); // real bytes, not an empty stream

    // 9. Someone else can't reach any of this — the authorization story
    // holds for every resource this workflow just created, not just the
    // project itself.
    const strangerReg = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `e2e-stranger-${Date.now()}@example.com`, password: 'password123' });
    const strangerAuth = { Authorization: `Bearer ${strangerReg.body.accessToken}` };

    const strangerProject = await request(app).get(`/api/v1/projects/${projectId}`).set(strangerAuth);
    expect(strangerProject.status).toBe(404);

    const strangerJob = await request(app).get(`/api/v1/jobs/${jobId}`).set(strangerAuth);
    expect(strangerJob.status).toBe(404);

    const strangerDownload = await request(app).get(`/api/v1/clips/${clip.id}/download`).set(strangerAuth);
    expect(strangerDownload.status).toBe(404);
  }, 30000);
});
