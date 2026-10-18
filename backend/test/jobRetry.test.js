const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const redis = require('../src/redis/client');
const { PHYSICAL_QUEUES, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');
const reaper = require('../src/workers/stuckJobReaper');

const app = createApp();
const jobsIn = (q) => getPhysicalQueue(q).getJobs(['waiting', 'delayed', 'active', 'prioritized']);

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token) {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Retry test' });
  return res.body.project;
}

/** A job in `state`, with the event history a real failure leaves behind. */
async function createJob(project, userId, { state = 'FAILED', failedFrom = 'TRANSCRIBING', assetStatus = 'validated', rejection } = {}) {
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: userId,
      original_filename: 'test.mp4',
      storage_key: `${project.workspace_id}/${project.id}/ULID.mp4`,
      mime_type: 'video/mp4',
      size_bytes: 1024,
      checksum_sha256: `c-${Date.now()}-${Math.random()}`,
      status: assetStatus,
      rejection_reason: rejection || null,
    })
    .returning('*');
  const [job] = await db('processing_jobs')
    .insert({
      media_asset_id: asset.id,
      state,
      failure_stage: state === 'FAILED' ? failedFrom : null,
      error_message: state === 'FAILED' ? 'it broke' : null,
      completed_at: state === 'FAILED' ? new Date() : null,
    })
    .returning('*');
  if (state === 'FAILED' && failedFrom) {
    await db('processing_job_events').insert({ processing_job_id: job.id, from_state: failedFrom, to_state: 'FAILED' });
  }
  return { job, asset };
}

const retry = (token, jobId) => request(app).post(`/api/v1/jobs/${jobId}/retry`).set('Authorization', `Bearer ${token}`);

let owner;
let project;

beforeEach(async () => {
  await resetDb();
  for (const name of Object.values(PHYSICAL_QUEUES)) {
     
    await getPhysicalQueue(name).obliterate({ force: true });
  }
  await redis.del('reaper:lock');
  owner = await registerUser(`retry-${Date.now()}@example.com`);
  project = await createProject(owner.token);
});

afterAll(async () => {
  for (const name of Object.values(PHYSICAL_QUEUES)) {
     
    await getPhysicalQueue(name).obliterate({ force: true });
  }
  await closeAllQueues();
});

describe('POST /jobs/:jobId/retry', () => {
  it('resumes a failed job at the stage it failed in, with its failure cleared', async () => {
    const { job, asset } = await createJob(project, owner.userId, { failedFrom: 'TRANSCRIBING' });

    const res = await retry(owner.token, job.id);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ id: job.id, state: 'TRANSCRIBING', stateGroup: 'transcribing', errorMessage: null, failureStage: null, completedAt: null });
    const row = await db('processing_jobs').where({ id: job.id }).first();
    expect(row).toMatchObject({ state: 'TRANSCRIBING', error_message: null, failure_stage: null, completed_at: null });

    const queued = await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION);
    expect(queued).toHaveLength(1);
    expect(queued[0].name).toBe('transcription.process');
    expect(queued[0].data).toEqual({
      processingJobId: job.id,
      mediaAssetId: asset.id,
      audioStorageKey: asset.storage_key.replace('.mp4', '.audio.wav'),
    });

    const events = (await request(app).get(`/api/v1/jobs/${job.id}/events`).set('Authorization', `Bearer ${owner.token}`)).body.data;
    expect(events[events.length - 1]).toMatchObject({ fromState: 'FAILED', toState: 'TRANSCRIBING', metadata: { retry: true } });
  });

  it.each([
    ['FINDING_CLIPS', PHYSICAL_QUEUES.AI, 'clips.detect'],
    ['RENDERING_CLIPS', PHYSICAL_QUEUES.RENDER, 'clip.render'],
    ['GENERATING_CONTENT', PHYSICAL_QUEUES.AI, 'content.generate'],
    ['EXTRACTING_AUDIO', PHYSICAL_QUEUES.LIGHT, 'audio.extract'],
  ])('a job that failed in %s goes back to the right stage', async (failedFrom, queue, jobName) => {
    const { job } = await createJob(project, owner.userId, { failedFrom });
    expect((await retry(owner.token, job.id)).status).toBe(202);
    expect((await jobsIn(queue)).map((j) => j.name)).toEqual([jobName]);
  });

  it('refuses a job that has not failed', async () => {
    const { job } = await createJob(project, owner.userId, { state: 'TRANSCRIBING' });
    const res = await retry(owner.token, job.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_RETRYABLE');
    expect(await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).toHaveLength(0);
  });

  it('refuses media that was rejected at validation, so retry cannot bypass those checks', async () => {
    const { job } = await createJob(project, owner.userId, {
      failedFrom: 'VALIDATING',
      assetStatus: 'rejected',
      rejection: 'Video has no audio track',
    });
    const res = await retry(owner.token, job.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('no audio track');
    expect((await db('processing_jobs').where({ id: job.id }).first()).state).toBe('FAILED');
  });

  it('refuses a failed job whose failing stage is unknown', async () => {
    const { job } = await createJob(project, owner.userId, { failedFrom: null });
    const res = await retry(owner.token, job.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_RETRYABLE');
  });

  it("404s for another user's job and 401s without auth", async () => {
    const { job } = await createJob(project, owner.userId);
    const other = await registerUser(`other-${Date.now()}@example.com`);
    expect((await retry(other.token, job.id)).status).toBe(404);
    expect((await request(app).post(`/api/v1/jobs/${job.id}/retry`)).status).toBe(401);
    expect((await db('processing_jobs').where({ id: job.id }).first()).state).toBe('FAILED');
  });

  it('respects the concurrent-jobs limit', async () => {
    const { job } = await createJob(project, owner.userId);
    await createJob(project, owner.userId, { state: 'ANALYZING' });
    await createJob(project, owner.userId, { state: 'RENDERING_CLIPS' }); // limit is 2 in the test env

    const res = await retry(owner.token, job.id);

    expect(res.status).toBe(429);
    expect((await db('processing_jobs').where({ id: job.id }).first()).state).toBe('FAILED');
    expect(await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).toHaveLength(0);
  });

  it('a double click retries once: one request wins, the other gets a conflict, one job is queued', async () => {
    const { job } = await createJob(project, owner.userId);

    const results = await Promise.all([retry(owner.token, job.id), retry(owner.token, job.id), retry(owner.token, job.id)]);

    expect(results.map((r) => r.status).sort()).toEqual([202, 409, 409]);
    expect(await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).toHaveLength(1);
  });

  it('gives the reaper a fresh re-enqueue allowance after a retry', async () => {
    const { job } = await createJob(project, owner.userId, { failedFrom: 'TRANSCRIBING' });
    const max = require('../src/config').reaper.maxRequeuesPerStage;
    // Allowance already used up before the user retried...
    for (let i = 1; i <= max; i += 1) {
       
      await db('processing_job_events').insert({
        processing_job_id: job.id,
        from_state: 'TRANSCRIBING',
        to_state: 'TRANSCRIBING',
        metadata: JSON.stringify({ reaper: 'requeued', attempt: i }),
      });
    }
    expect((await retry(owner.token, job.id)).status).toBe(202);

    // ...then the retried job's queue job vanishes and it goes stale.
    await getPhysicalQueue(PHYSICAL_QUEUES.TRANSCRIPTION).obliterate({ force: true });
    await db('processing_jobs').where({ id: job.id }).update({ updated_at: new Date(Date.now() - 10 * 60 * 1000) });

    const result = await reaper.sweep();

    expect(result).toMatchObject({ requeued: 1, failed: 0 }); // not failed straight away
  });
});
