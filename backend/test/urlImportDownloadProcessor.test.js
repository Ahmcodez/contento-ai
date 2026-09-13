jest.mock('../src/providers/ProviderResolver');
jest.mock('../src/services/media.service');
const fs = require('fs/promises');
const path = require('path');
const { getProviderByName } = require('../src/providers/ProviderResolver');
const mediaService = require('../src/services/media.service');
const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const config = require('../src/config');
const mediaImportRepository = require('../src/repositories/mediaImport.repository');
const { ProviderError } = require('../src/providers/URLProvider');
const AppError = require('../src/utils/AppError');
const processUrlImportDownload = require('../src/workers/processors/urlImportDownload.processor');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token) {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Download processor test' });
  return res.body.project;
}

async function createWaitingImport(project, userId, overrides = {}) {
  const row = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://youtube.com/watch?v=abc' });
  await db('media_imports').where({ id: row.id }).update({ state: 'DOWNLOADING', provider: 'youtube', ...overrides });
  return db('media_imports').where({ id: row.id }).first();
}

describe('urlImportDownload.processor', () => {
  beforeEach(async () => {
    await resetDb();
    jest.clearAllMocks();
  });

  it('does nothing if the media_imports row no longer exists', async () => {
    await expect(processUrlImportDownload({ data: { mediaImportId: '00000000-0000-0000-0000-000000000000' } })).resolves.toBeUndefined();
    expect(getProviderByName).not.toHaveBeenCalled();
  });

  it('does nothing (does not call the provider) if the row is not in DOWNLOADING state', async () => {
    const { token, userId } = await registerUser('dl1@example.com');
    const project = await createProject(token);
    const row = await mediaImportRepository.create({ projectId: project.id, requestedBy: userId, sourceUrl: 'https://youtube.com/watch?v=abc' });
    // left in DETECTING_PROVIDER — never confirmed

    await processUrlImportDownload({ data: { mediaImportId: row.id } });
    expect(getProviderByName).not.toHaveBeenCalled();
  });

  it('fails cleanly and cleans up the temp file when download throws a non-retryable ProviderError', async () => {
    const { token, userId } = await registerUser('dl2@example.com');
    const project = await createProject(token);
    const row = await createWaitingImport(project, userId);

    const download = jest.fn().mockImplementation(async (url, destPath) => {
      await fs.writeFile(destPath, 'partial'); // simulate a partial write before failing
      throw new ProviderError('This video is private', { retryable: false, reason: 'private_video' });
    });
    getProviderByName.mockReturnValue({ download });

    await processUrlImportDownload({ data: { mediaImportId: row.id } });

    const updated = await db('media_imports').where({ id: row.id }).first();
    expect(updated.state).toBe('FAILED');
    expect(updated.failure_stage).toBe('DOWNLOADING');
    expect(updated.error_message).toBe('This video is private');

    const tmpPath = path.join(config.storage.tmpPath, `import-${row.id}.mp4`);
    await expect(fs.access(tmpPath)).rejects.toThrow(); // cleaned up
  });

  it('rethrows (does not mark FAILED) when download throws a retryable ProviderError', async () => {
    const { token, userId } = await registerUser('dl3@example.com');
    const project = await createProject(token);
    const row = await createWaitingImport(project, userId);

    getProviderByName.mockReturnValue({
      download: jest.fn().mockRejectedValue(new ProviderError('Timed out', { retryable: true, reason: 'timeout' })),
    });

    await expect(processUrlImportDownload({ data: { mediaImportId: row.id } })).rejects.toThrow('Timed out');

    const updated = await db('media_imports').where({ id: row.id }).first();
    expect(updated.state).toBe('DOWNLOADING'); // unchanged, BullMQ will retry
  });

  it('on successful download + validation, calls createMediaAssetFromLocalFile and transitions to COMPLETED', async () => {
    const { token, userId } = await registerUser('dl4@example.com');
    const project = await createProject(token);
    const row = await createWaitingImport(project, userId, { title: 'My Video', source_id: 'abc123' });

    // media_imports.media_asset_id and .processing_job_id both have real
    // FKs, so the mocked createMediaAssetFromLocalFile needs to "create"
    // rows that actually exist for the subsequent transitionState update
    // to satisfy those constraints — exactly as the real function would.
    const [realAsset] = await db('media_assets')
      .insert({
        project_id: project.id,
        uploaded_by: userId,
        original_filename: 'my-video.mp4',
        storage_key: `${project.workspace_id}/${project.id}/fake.mp4`,
        mime_type: 'video/mp4',
        size_bytes: 1024,
        checksum_sha256: `checksum-${Date.now()}`,
        status: 'uploaded',
      })
      .returning('*');
    const [realJob] = await db('processing_jobs').insert({ media_asset_id: realAsset.id, state: 'UPLOADED' }).returning('*');

    getProviderByName.mockReturnValue({ download: jest.fn().mockResolvedValue({ filePath: 'ignored' }) });
    mediaService.createMediaAssetFromLocalFile.mockResolvedValue({
      mediaAsset: realAsset,
      processingJob: realJob,
    });

    await processUrlImportDownload({ data: { mediaImportId: row.id } });

    expect(mediaService.createMediaAssetFromLocalFile).toHaveBeenCalledWith(
      project.id,
      userId,
      expect.stringContaining(`import-${row.id}`),
      expect.objectContaining({
        displayName: 'My Video',
        sourceMetadata: expect.objectContaining({ provider: 'youtube', sourceId: 'abc123', title: 'My Video' }),
      }),
    );

    const updated = await db('media_imports').where({ id: row.id }).first();
    expect(updated.state).toBe('COMPLETED');
    expect(updated.media_asset_id).toBe(realAsset.id);
    expect(updated.processing_job_id).toBe(realJob.id);
    expect(updated.progress_percent).toBe(100);
  });

  it('fails cleanly when createMediaAssetFromLocalFile rejects with an AppError (e.g. unsupported content)', async () => {
    const { token, userId } = await registerUser('dl5@example.com');
    const project = await createProject(token);
    const row = await createWaitingImport(project, userId);

    getProviderByName.mockReturnValue({ download: jest.fn().mockResolvedValue({}) });
    mediaService.createMediaAssetFromLocalFile.mockRejectedValue(AppError.unsupportedMediaType('File content does not match a supported video format'));

    await processUrlImportDownload({ data: { mediaImportId: row.id } });

    const updated = await db('media_imports').where({ id: row.id }).first();
    expect(updated.state).toBe('FAILED');
    expect(updated.failure_stage).toBe('VALIDATING_MEDIA');
    expect(updated.error_message).toMatch(/does not match a supported video format/);
  });

  it('rethrows an unexpected (non-AppError) error from createMediaAssetFromLocalFile rather than marking FAILED', async () => {
    const { token, userId } = await registerUser('dl6@example.com');
    const project = await createProject(token);
    const row = await createWaitingImport(project, userId);

    getProviderByName.mockReturnValue({ download: jest.fn().mockResolvedValue({}) });
    mediaService.createMediaAssetFromLocalFile.mockRejectedValue(new Error('transient DB blip'));

    await expect(processUrlImportDownload({ data: { mediaImportId: row.id } })).rejects.toThrow('transient DB blip');

    const updated = await db('media_imports').where({ id: row.id }).first();
    expect(updated.state).toBe('VALIDATING_MEDIA'); // unchanged, BullMQ will retry
  });
});
