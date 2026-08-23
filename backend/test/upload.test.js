const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');
const createApp = require('../src/app');

const app = createApp();

const FIXTURES_DIR = path.join(os.tmpdir(), 'contento-test-fixtures');

function writeFixture(name, content) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const p = path.join(FIXTURES_DIR, name);
  fs.writeFileSync(p, content);
  return p;
}

async function registerAndCreateProject(email) {
  const reg = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  const token = reg.body.accessToken;
  const proj = await request(app)
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Upload test project' });
  return { token, projectId: proj.body.project.id };
}

describe('media upload', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects a request with no file', async () => {
    const { token, projectId } = await registerAndCreateProject('upload1@example.com');
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
  });

  it('rejects a file with a disallowed extension', async () => {
    const { token, projectId } = await registerAndCreateProject('upload2@example.com');
    const filePath = writeFixture('not-a-video.txt', 'hello world');

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Authorization', `Bearer ${token}`)
      .attach('video', filePath);

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a file with an mp4 extension but non-video content (magic byte check)', async () => {
    const { token, projectId } = await registerAndCreateProject('upload3@example.com');
    const filePath = writeFixture('fake.mp4', 'this is not really an mp4 file');

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Authorization', `Bearer ${token}`)
      .attach('video', filePath);

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an upload to a project owned by someone else', async () => {
    const { projectId } = await registerAndCreateProject('victim@example.com');
    const attacker = await request(app).post('/api/v1/auth/register').send({ email: 'attacker@example.com', password: 'password123' });
    const filePath = writeFixture('fake2.mp4', 'not a video');

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Authorization', `Bearer ${attacker.body.accessToken}`)
      .attach('video', filePath);

    expect(res.status).toBe(404);
  });

  it('rejects a file over the configured size limit', async () => {
    const { token, projectId } = await registerAndCreateProject('bigupload@example.com');
    // MAX_UPLOAD_SIZE_MB is set to 10 in test env — write 11MB.
    const big = Buffer.alloc(11 * 1024 * 1024, 'a');
    const filePath = writeFixture('too-big.mp4', big);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/media`)
      .set('Authorization', `Bearer ${token}`)
      .attach('video', filePath);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});
