const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const config = require('../src/config');
const { PHYSICAL_QUEUES, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');
const { resolveClipCount } = require('../src/utils/clipCount');

const app = createApp();
const SAMPLE = path.join(__dirname, 'fixtures', 'sample.mp4');
const { maxClipsPerVideo, defaultClipsPerVideo } = config.limits;

async function registerAndCreateProject(email) {
  const reg = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  const token = reg.body.accessToken;
  const proj = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Clip count' });
  return { token, projectId: proj.body.project.id };
}

describe('resolveClipCount', () => {
  it('uses the configured default when nothing is chosen', () => {
    for (const empty of [undefined, null, '']) expect(resolveClipCount(empty)).toBe(defaultClipsPerVideo);
  });

  it('accepts whole numbers and numeric strings (multipart fields arrive as strings) inside the limits', () => {
    expect(resolveClipCount(1)).toBe(1);
    expect(resolveClipCount('7')).toBe(7);
    expect(resolveClipCount(maxClipsPerVideo)).toBe(maxClipsPerVideo);
  });

  it.each([0, -3, maxClipsPerVideo + 1, 2.5, 'abc', '3 clips', NaN])('rejects %p', (bad) => {
    expect(() => resolveClipCount(bad)).toThrow(expect.objectContaining({ code: 'INVALID_CLIP_COUNT', statusCode: 422 }));
  });
});

async function clearQueues() {
  for (const name of [PHYSICAL_QUEUES.LIGHT, PHYSICAL_QUEUES.DOWNLOAD]) {
     
    await getPhysicalQueue(name).obliterate({ force: true });
  }
}

beforeEach(async () => {
  await resetDb();
  await clearQueues();
});

afterAll(async () => {
  await clearQueues();
  await closeAllQueues();
});

describe('clip count on upload', () => {
  const upload = (token, projectId, clipCount) => {
    const req = request(app).post(`/api/v1/projects/${projectId}/media`).set('Authorization', `Bearer ${token}`);
    if (clipCount !== undefined) req.field('clipCount', String(clipCount));
    return req.attach('video', SAMPLE);
  };

  it('stores the chosen count on the job and shows it in the job API', async () => {
    const { token, projectId } = await registerAndCreateProject('cc1@example.com');
    const res = await upload(token, projectId, 3);
    expect(res.status).toBe(202);

    const job = await db('processing_jobs').where({ id: res.body.processingJob.id }).first();
    expect(job.requested_clip_count).toBe(3);

    const api = await request(app).get(`/api/v1/jobs/${job.id}`).set('Authorization', `Bearer ${token}`);
    expect(api.body.requestedClipCount).toBe(3);
  });

  it('falls back to the default when the client sends no count', async () => {
    const { token, projectId } = await registerAndCreateProject('cc2@example.com');
    const res = await upload(token, projectId);
    expect(res.status).toBe(202);
    const job = await db('processing_jobs').where({ id: res.body.processingJob.id }).first();
    expect(job.requested_clip_count).toBe(defaultClipsPerVideo);
  });

  it.each([['0'], [String(maxClipsPerVideo + 1)], ['lots']])('rejects %p and creates nothing', async (bad) => {
    const { token, projectId } = await registerAndCreateProject(`cc3-${bad}@example.com`);
    const res = await upload(token, projectId, bad);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CLIP_COUNT');
    expect(await db('media_assets')).toHaveLength(0);
    expect(await db('processing_jobs')).toHaveLength(0);
  });
});

describe('clip count on URL import', () => {
  const paste = (token, projectId, body) =>
    request(app).post(`/api/v1/projects/${projectId}/media/url`).set('Authorization', `Bearer ${token}`).send({ url: 'https://youtube.com/watch?v=abc', ...body });

  async function waitingImport(token, projectId, body) {
    const res = await paste(token, projectId, body);
    const id = res.body.mediaImport.id;
    await db('media_imports').where({ id }).update({ state: 'WAITING_CONFIRMATION', provider: 'youtube', duration_seconds: 600, title: 'T' });
    return { id, res };
  }
  const confirm = (token, id, body) => request(app).post(`/api/v1/media-imports/${id}/confirm`).set('Authorization', `Bearer ${token}`).send(body);

  it('records the count given when the URL is pasted', async () => {
    const { token, projectId } = await registerAndCreateProject('cc4@example.com');
    const { res } = await waitingImport(token, projectId, { clipCount: 8 });
    expect(res.status).toBe(202);
    expect(res.body.mediaImport.requestedClipCount).toBe(8);
  });

  it('leaves it unset when none is given (the default applies at job creation)', async () => {
    const { token, projectId } = await registerAndCreateProject('cc5@example.com');
    const { res } = await waitingImport(token, projectId);
    expect(res.body.mediaImport.requestedClipCount).toBeNull();
  });

  it('rejects an out-of-range count at paste time', async () => {
    const { token, projectId } = await registerAndCreateProject('cc6@example.com');
    const res = await paste(token, projectId, { clipCount: maxClipsPerVideo + 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CLIP_COUNT');
    expect(await db('media_imports')).toHaveLength(0);
  });

  it('lets the user change it at the confirm step, after seeing the video length', async () => {
    const { token, projectId } = await registerAndCreateProject('cc7@example.com');
    const { id } = await waitingImport(token, projectId, { clipCount: 4 });
    const res = await confirm(token, id, { clipCount: 12 });
    expect(res.status).toBe(200);
    expect(res.body.mediaImport.requestedClipCount).toBe(12);
    expect((await db('media_imports').where({ id }).first()).requested_clip_count).toBe(12);
  });

  it('keeps the earlier choice when confirm sends nothing', async () => {
    const { token, projectId } = await registerAndCreateProject('cc8@example.com');
    const { id } = await waitingImport(token, projectId, { clipCount: 6 });
    expect((await confirm(token, id)).status).toBe(200);
    expect((await db('media_imports').where({ id }).first()).requested_clip_count).toBe(6);
  });

  it('rejects a bad count at confirm without moving the import forward', async () => {
    const { token, projectId } = await registerAndCreateProject('cc9@example.com');
    const { id } = await waitingImport(token, projectId);
    const res = await confirm(token, id, { clipCount: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CLIP_COUNT');
    expect((await db('media_imports').where({ id }).first()).state).toBe('WAITING_CONFIRMATION');
  });
});
