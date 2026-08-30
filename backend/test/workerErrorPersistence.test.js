const db = require('../src/db/client');
const request = require('supertest');
const createApp = require('../src/app');
const { wrapWithErrorPersistence } = require('../src/workers/index');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token) {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Worker error test' });
  return res.body.project;
}

async function createJob(project, userId, state) {
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: userId,
      original_filename: 'test.mp4',
      storage_key: `${project.workspace_id}/${project.id}/fake.mp4`,
      mime_type: 'video/mp4',
      size_bytes: 1024,
      checksum_sha256: `checksum-${Date.now()}-${Math.random()}`,
      status: 'validated',
      duration_seconds: 20,
    })
    .returning('*');

  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state }).returning('*');
  return job;
}

function fakeJob({ processingJobId, attemptsMade, attempts }) {
  return { id: 'fake-bullmq-job-id', data: { processingJobId }, attemptsMade, opts: { attempts } };
}

describe('wrapWithErrorPersistence (worker retry-exhaustion / terminal-failure handling)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rethrows the original error regardless of attempt number, so BullMQ still records/retries correctly', async () => {
    const { token, userId } = await registerUser('werr1@example.com');
    const project = await createProject(token);
    const job = await createJob(project, userId, 'EXTRACTING_AUDIO');

    const boom = new Error('ffmpeg exploded');
    const handler = jest.fn().mockRejectedValue(boom);
    const wrapped = wrapWithErrorPersistence('audio-extract', handler);

    await expect(
      wrapped(fakeJob({ processingJobId: job.id, attemptsMade: 0, attempts: 3 })),
    ).rejects.toThrow('ffmpeg exploded');
  });

  it('on a non-final attempt, does not persist a processing_errors row or change job state (BullMQ will retry)', async () => {
    const { token, userId } = await registerUser('werr2@example.com');
    const project = await createProject(token);
    const job = await createJob(project, userId, 'EXTRACTING_AUDIO');

    const handler = jest.fn().mockRejectedValue(new Error('transient failure'));
    const wrapped = wrapWithErrorPersistence('audio-extract', handler);

    // attemptsMade: 0 with attempts: 3 means this is the 1st of 3 allowed
    // attempts — not the last one.
    await wrapped(fakeJob({ processingJobId: job.id, attemptsMade: 0, attempts: 3 })).catch(() => {});

    const errors = await db('processing_errors').where({ processing_job_id: job.id });
    expect(errors).toHaveLength(0);

    const current = await db('processing_jobs').where({ id: job.id }).first();
    expect(current.state).toBe('EXTRACTING_AUDIO'); // unchanged — still mid-pipeline, not failed
  });

  it('on the final attempt, persists a processing_errors row and transitions the job to FAILED', async () => {
    const { token, userId } = await registerUser('werr3@example.com');
    const project = await createProject(token);
    const job = await createJob(project, userId, 'EXTRACTING_AUDIO');

    const handler = jest.fn().mockRejectedValue(new Error('disk full'));
    const wrapped = wrapWithErrorPersistence('audio-extract', handler);

    // attemptsMade: 2 with attempts: 3 means this IS the 3rd and final attempt.
    await wrapped(fakeJob({ processingJobId: job.id, attemptsMade: 2, attempts: 3 })).catch(() => {});

    const errors = await db('processing_errors').where({ processing_job_id: job.id });
    expect(errors).toHaveLength(1);
    expect(errors[0].stage).toBe('audio-extract');
    expect(errors[0].message).toBe('disk full');
    expect(errors[0].retry_count).toBe(2);

    const current = await db('processing_jobs').where({ id: job.id }).first();
    expect(current.state).toBe('FAILED');
    expect(current.failure_stage).toBe('audio-extract');
    // A user-facing message, not the raw internal error string — avoids
    // leaking implementation detail ("disk full") into the product UI.
    expect(current.error_message).not.toBe('disk full');
    expect(current.error_message).toMatch(/failed/i);
  });

  it('still records the error for audit purposes even if the job was already cancelled mid-flight, but does not overwrite CANCELLED back to FAILED', async () => {
    const { token, userId } = await registerUser('werr4@example.com');
    const project = await createProject(token);
    // Simulates: user cancels the job while a stage is already in flight;
    // that stage then fails on its last attempt shortly after.
    const job = await createJob(project, userId, 'CANCELLED');

    const handler = jest.fn().mockRejectedValue(new Error('failed after cancellation'));
    const wrapped = wrapWithErrorPersistence('clip-render', handler);

    await wrapped(fakeJob({ processingJobId: job.id, attemptsMade: 0, attempts: 1 })).catch(() => {});

    const errors = await db('processing_errors').where({ processing_job_id: job.id });
    expect(errors).toHaveLength(1); // still logged, for debugging

    const current = await db('processing_jobs').where({ id: job.id }).first();
    expect(current.state).toBe('CANCELLED'); // not clobbered back to FAILED
  });

  it('a genuinely single-attempt queue (attempts: 1) is already on its final attempt at attemptsMade: 0', async () => {
    const { token, userId } = await registerUser('werr5@example.com');
    const project = await createProject(token);
    const job = await createJob(project, userId, 'VALIDATING');

    const handler = jest.fn().mockRejectedValue(new Error('not a real video file'));
    const wrapped = wrapWithErrorPersistence('video-validate', handler);

    await wrapped(fakeJob({ processingJobId: job.id, attemptsMade: 0, attempts: 1 })).catch(() => {});

    const current = await db('processing_jobs').where({ id: job.id }).first();
    expect(current.state).toBe('FAILED');
  });
});
