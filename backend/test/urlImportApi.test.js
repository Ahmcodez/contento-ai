const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const { QUEUE_NAMES, getQueue, closeAllQueues } = require('../src/queue/queues');
const quotaService = require('../src/services/quota.service');

jest.mock('../src/services/quota.service');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token, title = 'URL import API test') {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title });
  return res.body.project;
}

describe('URL import API', () => {
  beforeEach(async () => {
    await resetDb();
    jest.clearAllMocks();
    quotaService.assertCanStartNewJob.mockResolvedValue(undefined);
    quotaService.assertWithinMonthlyProcessingMinutes.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await closeAllQueues();
  });

  describe('POST /projects/:id/media/url', () => {
    it('creates a media_import in DETECTING_PROVIDER and enqueues the resolve job', async () => {
      const { token } = await registerUser('urlapi1@example.com');
      const project = await createProject(token);
      const queue = getQueue(QUEUE_NAMES.URL_IMPORT_RESOLVE);
      await queue.drain();

      const res = await request(app)
        .post(`/api/v1/projects/${project.id}/media/url`)
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://youtube.com/watch?v=abc123' });

      expect(res.status).toBe(202);
      expect(res.body.mediaImport.state).toBe('DETECTING_PROVIDER');
      expect(res.body.mediaImport.sourceUrl).toBe('https://youtube.com/watch?v=abc123');

      const jobs = await queue.getJobs(['waiting', 'active']);
      expect(jobs.some((j) => j.data.mediaImportId === res.body.mediaImport.id)).toBe(true);
    });

    it('rejects a malformed URL with a 422 before ever touching the DB', async () => {
      const { token } = await registerUser('urlapi2@example.com');
      const project = await createProject(token);

      const res = await request(app)
        .post(`/api/v1/projects/${project.id}/media/url`)
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'not a url' });

      expect(res.status).toBe(422);
      const count = await db('media_imports').count('* as c').first();
      expect(Number(count.c)).toBe(0);
    });

    it('rejects a non-http(s) scheme (e.g. file://) with a 422', async () => {
      const { token } = await registerUser('urlapi3@example.com');
      const project = await createProject(token);

      const res = await request(app)
        .post(`/api/v1/projects/${project.id}/media/url`)
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'file:///etc/passwd' });

      expect(res.status).toBe(422);
    });

    it('returns 404 for a project the user does not own', async () => {
      const { token: tokenA } = await registerUser('urlapi4a@example.com');
      const projectA = await createProject(tokenA);
      const { token: tokenB } = await registerUser('urlapi4b@example.com');

      const res = await request(app)
        .post(`/api/v1/projects/${projectA.id}/media/url`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ url: 'https://youtube.com/watch?v=abc' });

      expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/projects/00000000-0000-0000-0000-000000000000/media/url').send({ url: 'https://youtube.com/watch?v=abc' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /media-imports/:mediaImportId', () => {
    it('returns the current state of an import belonging to the requesting user', async () => {
      const { token } = await registerUser('urlapi5@example.com');
      const project = await createProject(token);
      const createRes = await request(app)
        .post(`/api/v1/projects/${project.id}/media/url`)
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://youtube.com/watch?v=abc' });

      const res = await request(app)
        .get(`/api/v1/media-imports/${createRes.body.mediaImport.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.mediaImport.id).toBe(createRes.body.mediaImport.id);
      expect(res.body.mediaImport.state).toBe('DETECTING_PROVIDER');
    });

    it('returns 404 for an import belonging to a different user (no cross-tenant leakage)', async () => {
      const { token: tokenA } = await registerUser('urlapi6a@example.com');
      const projectA = await createProject(tokenA);
      const createRes = await request(app)
        .post(`/api/v1/projects/${projectA.id}/media/url`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ url: 'https://youtube.com/watch?v=abc' });

      const { token: tokenB } = await registerUser('urlapi6b@example.com');
      const res = await request(app)
        .get(`/api/v1/media-imports/${createRes.body.mediaImport.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /media-imports/:mediaImportId/confirm', () => {
    async function createWaitingImport(token, project, { durationSeconds = 60 } = {}) {
      const createRes = await request(app)
        .post(`/api/v1/projects/${project.id}/media/url`)
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://youtube.com/watch?v=abc' });
      const id = createRes.body.mediaImport.id;
      await db('media_imports').where({ id }).update({ state: 'WAITING_CONFIRMATION', provider: 'youtube', duration_seconds: durationSeconds, title: 'Test video' });
      return id;
    }

    it('transitions WAITING_CONFIRMATION -> DOWNLOADING and enqueues the download job', async () => {
      const { token } = await registerUser('urlapi7@example.com');
      const project = await createProject(token);
      const importId = await createWaitingImport(token, project);

      const queue = getQueue(QUEUE_NAMES.URL_IMPORT_DOWNLOAD);
      await queue.drain();

      const res = await request(app).post(`/api/v1/media-imports/${importId}/confirm`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.mediaImport.state).toBe('DOWNLOADING');

      const jobs = await queue.getJobs(['waiting', 'active']);
      expect(jobs.some((j) => j.data.mediaImportId === importId)).toBe(true);
    });

    it('rejects confirmation with 409 if the import is not in WAITING_CONFIRMATION', async () => {
      const { token } = await registerUser('urlapi8@example.com');
      const project = await createProject(token);
      const createRes = await request(app)
        .post(`/api/v1/projects/${project.id}/media/url`)
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://youtube.com/watch?v=abc' });
      // left in DETECTING_PROVIDER

      const res = await request(app)
        .post(`/api/v1/media-imports/${createRes.body.mediaImport.id}/confirm`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
    });

    it('rejects confirmation with 429 when the monthly processing-minutes quota would be exceeded', async () => {
      const { token } = await registerUser('urlapi9@example.com');
      const project = await createProject(token);
      const importId = await createWaitingImport(token, project, { durationSeconds: 3600 });

      const AppError = require('../src/utils/AppError');
      quotaService.assertWithinMonthlyProcessingMinutes.mockRejectedValue(AppError.tooManyRequests('This would exceed your monthly limit', 'QUOTA_EXCEEDED'));

      const res = await request(app).post(`/api/v1/media-imports/${importId}/confirm`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(429);
      const row = await db('media_imports').where({ id: importId }).first();
      expect(row.state).toBe('WAITING_CONFIRMATION'); // unchanged — rejected before any state change
    });

    it('returns 404 for confirming an import belonging to a different user', async () => {
      const { token: tokenA } = await registerUser('urlapi10a@example.com');
      const projectA = await createProject(tokenA);
      const importId = await createWaitingImport(tokenA, projectA);

      const { token: tokenB } = await registerUser('urlapi10b@example.com');
      const res = await request(app).post(`/api/v1/media-imports/${importId}/confirm`).set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });
});
