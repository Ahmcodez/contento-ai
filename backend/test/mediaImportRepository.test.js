const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const mediaImportRepository = require('../src/repositories/mediaImport.repository');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token, title = 'Import repo test') {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title });
  return res.body.project;
}

describe('mediaImport.repository', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('create() inserts a row defaulted to DETECTING_PROVIDER and logs the initial event', async () => {
    const { token, userId } = await registerUser('import1@example.com');
    const project = await createProject(token);

    const row = await mediaImportRepository.create({
      projectId: project.id,
      requestedBy: userId,
      sourceUrl: 'https://example.com/video.mp4',
    });

    expect(row.state).toBe('DETECTING_PROVIDER');
    expect(row.progress_percent).toBe(0);
    expect(row.source_url).toBe('https://example.com/video.mp4');

    const events = await db('media_import_events').where({ media_import_id: row.id });
    expect(events).toHaveLength(1);
    expect(events[0].from_state).toBeNull();
    expect(events[0].to_state).toBe('DETECTING_PROVIDER');
  });

  it('transitionState() updates state, appends an event, and sets completed_at only on a terminal state', async () => {
    const { token, userId } = await registerUser('import2@example.com');
    const project = await createProject(token);
    const row = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://example.com/v.mp4' });

    const mid = await mediaImportRepository.transitionState(row.id, {
      fromState: 'DETECTING_PROVIDER',
      toState: 'FETCHING_METADATA',
    });
    expect(mid.state).toBe('FETCHING_METADATA');
    expect(mid.completed_at).toBeNull();

    const done = await mediaImportRepository.transitionState(row.id, {
      fromState: 'DOWNLOADING',
      toState: 'COMPLETED',
      progressPercent: 100,
    });
    expect(done.state).toBe('COMPLETED');
    expect(done.completed_at).not.toBeNull();
    expect(done.progress_percent).toBe(100);

    const events = await db('media_import_events').where({ media_import_id: row.id }).orderBy('created_at', 'asc');
    expect(events.map((e) => e.to_state)).toEqual(['DETECTING_PROVIDER', 'FETCHING_METADATA', 'COMPLETED']);
  });

  it('transitionState() to FAILED records failureStage and errorMessage', async () => {
    const { token, userId } = await registerUser('import3@example.com');
    const project = await createProject(token);
    const row = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://example.com/v.mp4' });

    const failed = await mediaImportRepository.transitionState(row.id, {
      fromState: 'DOWNLOADING',
      toState: 'FAILED',
      failureStage: 'DOWNLOADING',
      errorMessage: 'Source file is too large',
    });

    expect(failed.state).toBe('FAILED');
    expect(failed.failure_stage).toBe('DOWNLOADING');
    expect(failed.error_message).toBe('Source file is too large');
    expect(failed.completed_at).not.toBeNull();
  });

  describe('findByIdScoped', () => {
    it('finds an import belonging to the requesting user\'s workspace', async () => {
      const { token, userId } = await registerUser('import4@example.com');
      const project = await createProject(token);
      const row = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://example.com/v.mp4' });

      const found = await mediaImportRepository.findByIdScoped(row.id, [project.workspace_id]);
      expect(found.id).toBe(row.id);
    });

    it('returns undefined for an import belonging to a different workspace (no cross-tenant leakage)', async () => {
      const { token: tokenA, userId: userIdA } = await registerUser('import5a@example.com');
      const projectA = await createProject(tokenA);
      const row = await mediaImportRepository.create({ projectId: projectA.id, requestedBy: userIdA, sourceUrl: 'https://example.com/v.mp4' });

      const { token: tokenB } = await registerUser('import5b@example.com');
      const projectB = await createProject(tokenB, 'Other workspace project');

      const found = await mediaImportRepository.findByIdScoped(row.id, [projectB.workspace_id]);
      expect(found).toBeUndefined();
    });
  });
});
