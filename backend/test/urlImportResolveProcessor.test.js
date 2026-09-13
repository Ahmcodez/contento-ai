jest.mock('../src/providers/ProviderResolver');
const { resolveProvider } = require('../src/providers/ProviderResolver');
const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const config = require('../src/config');
const mediaImportRepository = require('../src/repositories/mediaImport.repository');
const { ProviderError } = require('../src/providers/URLProvider');
const processUrlImportResolve = require('../src/workers/processors/urlImportResolve.processor');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token) {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Resolve processor test' });
  return res.body.project;
}

describe('urlImportResolve.processor', () => {
  beforeEach(async () => {
    await resetDb();
    jest.clearAllMocks();
  });

  it('fails cleanly (FAILED, not thrown) when the URL matches no provider', async () => {
    const { token, userId } = await registerUser('resolve1@example.com');
    const project = await createProject(token);
    const mediaImport = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://example.com/page' });

    resolveProvider.mockImplementation(() => {
      throw new ProviderError('Unsupported source', { retryable: false, reason: 'unsupported_provider' });
    });

    await expect(processUrlImportResolve({ data: { mediaImportId: mediaImport.id } })).resolves.toBeUndefined();

    const row = await db('media_imports').where({ id: mediaImport.id }).first();
    expect(row.state).toBe('FAILED');
    expect(row.failure_stage).toBe('DETECTING_PROVIDER');
    expect(row.error_message).toBe('Unsupported source');
  });

  it('transitions through FETCHING_METADATA to WAITING_CONFIRMATION on success, storing the preview fields', async () => {
    const { token, userId } = await registerUser('resolve2@example.com');
    const project = await createProject(token);
    const mediaImport = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://youtube.com/watch?v=abc' });

    resolveProvider.mockReturnValue({
      name: 'youtube',
      getMetadata: jest.fn().mockResolvedValue({
        sourceId: 'abc123',
        title: 'A great video',
        thumbnailUrl: 'https://example.com/t.jpg',
        durationSeconds: 90,
        width: 1920,
        height: 1080,
      }),
    });

    await processUrlImportResolve({ data: { mediaImportId: mediaImport.id } });

    const row = await db('media_imports').where({ id: mediaImport.id }).first();
    expect(row.state).toBe('WAITING_CONFIRMATION');
    expect(row.provider).toBe('youtube');
    expect(row.title).toBe('A great video');
    expect(row.thumbnail_url).toBe('https://example.com/t.jpg');
    expect(Number(row.duration_seconds)).toBe(90);
    expect(row.width).toBe(1920);
    expect(row.height).toBe(1080);
    expect(row.progress_percent).toBe(50);

    const events = await db('media_import_events').where({ media_import_id: mediaImport.id }).orderBy('created_at', 'asc');
    expect(events.map((e) => e.to_state)).toEqual(['DETECTING_PROVIDER', 'FETCHING_METADATA', 'WAITING_CONFIRMATION']);
  });

  it('fails cleanly when getMetadata throws a non-retryable ProviderError (e.g. private video)', async () => {
    const { token, userId } = await registerUser('resolve3@example.com');
    const project = await createProject(token);
    const mediaImport = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://youtube.com/watch?v=priv' });

    resolveProvider.mockReturnValue({
      name: 'youtube',
      getMetadata: jest.fn().mockRejectedValue(new ProviderError('This video is private', { retryable: false, reason: 'private_video' })),
    });

    await processUrlImportResolve({ data: { mediaImportId: mediaImport.id } });

    const row = await db('media_imports').where({ id: mediaImport.id }).first();
    expect(row.state).toBe('FAILED');
    expect(row.failure_stage).toBe('FETCHING_METADATA');
    expect(row.error_message).toBe('This video is private');
  });

  it('rethrows (does not mark FAILED) when getMetadata throws a retryable ProviderError, so BullMQ can retry', async () => {
    const { token, userId } = await registerUser('resolve4@example.com');
    const project = await createProject(token);
    const mediaImport = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://youtube.com/watch?v=x' });

    resolveProvider.mockReturnValue({
      name: 'youtube',
      getMetadata: jest.fn().mockRejectedValue(new ProviderError('Network blip', { retryable: true, reason: 'network_error' })),
    });

    await expect(processUrlImportResolve({ data: { mediaImportId: mediaImport.id } })).rejects.toThrow('Network blip');

    const row = await db('media_imports').where({ id: mediaImport.id }).first();
    expect(row.state).toBe('FETCHING_METADATA'); // unchanged — not clobbered to FAILED, BullMQ will retry
  });

  it('rejects a video over the max duration before ever reaching WAITING_CONFIRMATION', async () => {
    const { token, userId } = await registerUser('resolve5@example.com');
    const project = await createProject(token);
    const mediaImport = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://youtube.com/watch?v=long' });

    resolveProvider.mockReturnValue({
      name: 'youtube',
      getMetadata: jest.fn().mockResolvedValue({
        sourceId: 'long1',
        title: 'A very long video',
        thumbnailUrl: null,
        durationSeconds: config.limits.maxVideoDurationSeconds + 3600,
        width: null,
        height: null,
      }),
    });

    await processUrlImportResolve({ data: { mediaImportId: mediaImport.id } });

    const row = await db('media_imports').where({ id: mediaImport.id }).first();
    expect(row.state).toBe('FAILED');
    expect(row.error_message).toMatch(/exceeds the/i);
  });

  it('returns quietly if the media_imports row no longer exists (deleted/cancelled before the job ran)', async () => {
    await expect(processUrlImportResolve({ data: { mediaImportId: '00000000-0000-0000-0000-000000000000' } })).resolves.toBeUndefined();
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
