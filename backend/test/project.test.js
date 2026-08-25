const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return res.body.accessToken;
}

describe('projects', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a project for the authenticated user', async () => {
    const token = await registerUser('owner@example.com');
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'My project' });

    expect(res.status).toBe(201);
    expect(res.body.project.title).toBe('My project');
  });

  it('rejects project creation without auth', async () => {
    const res = await request(app).post('/api/v1/projects').send({ title: 'No auth' });
    expect(res.status).toBe(401);
  });

  it('rejects a project with no title', async () => {
    const token = await registerUser('titleless@example.com');
    const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(422);
  });

  it('lists only the caller\'s own projects', async () => {
    const tokenA = await registerUser('a@example.com');
    const tokenB = await registerUser('b@example.com');

    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${tokenA}`).send({ title: 'A project' });
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${tokenB}`).send({ title: 'B project' });

    const res = await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('A project');
  });

  it('returns 404, not 403, when fetching another user\'s project', async () => {
    const tokenA = await registerUser('owner2@example.com');
    const tokenB = await registerUser('intruder@example.com');

    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Private project' });

    const res = await request(app)
      .get(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('includes media assets with their latest job when fetching a single project', async () => {
    const token = await registerUser('withassets@example.com');
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Has assets' });

    const db = require('../src/db/client');
    const [asset] = await db('media_assets')
      .insert({
        project_id: created.body.project.id,
        uploaded_by: me.body.user.id,
        original_filename: 'clip.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: `c-${Date.now()}`,
        status: 'validated',
      })
      .returning('*');
    await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'ANALYZING', progress_percent: 55 });

    const res = await request(app)
      .get(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.project.mediaAssets).toHaveLength(1);
    expect(res.body.project.mediaAssets[0].originalFilename).toBe('clip.mp4');
    expect(res.body.project.mediaAssets[0].latestJob).toEqual({
      id: expect.any(String),
      state: 'ANALYZING',
      progressPercent: 55,
    });
  });

  it('returns an empty mediaAssets array for a project with no uploads', async () => {
    const token = await registerUser('noassets@example.com');
    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Empty project' });

    const res = await request(app)
      .get(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.project.mediaAssets).toEqual([]);
  });

  it('prevents another user from updating a project they do not own', async () => {
    const tokenA = await registerUser('owner3@example.com');
    const tokenB = await registerUser('intruder2@example.com');

    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Original title' });

    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Hijacked title' });

    expect(res.status).toBe(404);
  });

  it('prevents another user from deleting a project they do not own', async () => {
    const tokenA = await registerUser('owner4@example.com');
    const tokenB = await registerUser('intruder3@example.com');

    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Cannot delete me' });

    const res = await request(app)
      .delete(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('allows the owner to update their own project', async () => {
    const token = await registerUser('realowner@example.com');
    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Old title' });

    const res = await request(app)
      .patch(`/api/v1/projects/${created.body.project.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New title' });

    expect(res.status).toBe(200);
    expect(res.body.project.title).toBe('New title');
  });

  it('rejects a malformed project id', async () => {
    const token = await registerUser('malformed@example.com');
    const res = await request(app)
      .get('/api/v1/projects/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it('includes the latest processing job on each project in the list', async () => {
    const token = await registerUser('withjob@example.com');
    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Has a job' });

    const db = require('../src/db/client');
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    const [asset] = await db('media_assets')
      .insert({
        project_id: created.body.project.id,
        uploaded_by: me.body.user.id,
        original_filename: 'x.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: `c-${Date.now()}`,
      })
      .returning('*');
    await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'TRANSCRIBING', progress_percent: 40 });

    const res = await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${token}`);
    const project = res.body.data.find((p) => p.id === created.body.project.id);
    expect(project.latest_job).toEqual({ id: expect.any(String), state: 'TRANSCRIBING', progressPercent: 40 });
  });

  it('returns latest_job as null for a project with no uploads yet', async () => {
    const token = await registerUser('nojob@example.com');
    await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'No uploads' });

    const res = await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${token}`);
    expect(res.body.data[0].latest_job).toBeNull();
  });
});
