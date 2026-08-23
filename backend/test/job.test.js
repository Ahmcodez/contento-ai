const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return res.body.accessToken;
}

async function createProject(token, title = 'Job status project') {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title });
  return res.body.project;
}

// Inserts a media_asset + processing_job directly, bypassing the upload
// flow, since these tests are about the job-status API surface, not the
// upload pipeline (covered separately in upload.test.js).
async function createJobDirectly(project, userId, state = 'UPLOADED') {
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: userId,
      original_filename: 'test.mp4',
      storage_key: `${project.workspace_id}/${project.id}/fake.mp4`,
      mime_type: 'video/mp4',
      size_bytes: 1024,
      checksum_sha256: `checksum-${Date.now()}-${Math.random()}`,
      status: 'uploaded',
    })
    .returning('*');

  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state }).returning('*');
  await db('processing_job_events').insert({ processing_job_id: job.id, from_state: null, to_state: state });

  return job;
}

describe('job status', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns job state and a mapped state group', async () => {
    const token = await registerUser('jobowner@example.com');
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    const project = await createProject(token);
    const job = await createJobDirectly(project, me.body.user.id, 'TRANSCRIBING');

    const res = await request(app).get(`/api/v1/jobs/${job.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('TRANSCRIBING');
    expect(res.body.stateGroup).toBe('transcribing');
  });

  it('returns 404 for a job belonging to another user', async () => {
    const tokenA = await registerUser('jobownerA@example.com');
    const meA = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
    const project = await createProject(tokenA);
    const job = await createJobDirectly(project, meA.body.user.id);

    const tokenB = await registerUser('jobstranger@example.com');
    const res = await request(app).get(`/api/v1/jobs/${job.id}`).set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('returns full event history for a job', async () => {
    const token = await registerUser('jobevents@example.com');
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    const project = await createProject(token);
    const job = await createJobDirectly(project, me.body.user.id);

    const res = await request(app).get(`/api/v1/jobs/${job.id}/events`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].toState).toBe('UPLOADED');
  });

  it('cancels an in-progress job', async () => {
    const token = await registerUser('jobcancel@example.com');
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    const project = await createProject(token);
    const job = await createJobDirectly(project, me.body.user.id, 'TRANSCRIBING');

    const res = await request(app).post(`/api/v1/jobs/${job.id}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CANCELLED');
  });

  it('refuses to cancel a job that already completed', async () => {
    const token = await registerUser('jobdone@example.com');
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    const project = await createProject(token);
    const job = await createJobDirectly(project, me.body.user.id, 'COMPLETED');

    const res = await request(app).post(`/api/v1/jobs/${job.id}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_TERMINAL');
  });

  it('returns 404 for a nonexistent job id', async () => {
    const token = await registerUser('jobnone@example.com');
    const res = await request(app)
      .get('/api/v1/jobs/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed job id', async () => {
    const token = await registerUser('jobbad@example.com');
    const res = await request(app).get('/api/v1/jobs/not-a-uuid').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
  });
});
