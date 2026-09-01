const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');
const createApp = require('../src/app');
const config = require('../src/config');

const app = createApp();

const FIXTURES_DIR = path.join(os.tmpdir(), 'contento-quota-test-fixtures');
const SAMPLE_VIDEO = path.join(__dirname, 'fixtures', 'sample.mp4');

function writeFixtureCopy(name) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const dest = path.join(FIXTURES_DIR, name);
  const original = fs.readFileSync(SAMPLE_VIDEO);
  // Appending a few unique bytes gives each copy a distinct checksum
  // without touching the header the magic-byte detector reads, so tests
  // that need multiple *different* uploads from the same user don't
  // accidentally trip the duplicate-upload check instead of whatever
  // they're actually testing (e.g. the concurrency limit).
  const unique = Buffer.from(`${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(dest, Buffer.concat([original, unique]));
  return dest;
}

async function registerAndCreateProject(email) {
  const reg = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  const token = reg.body.accessToken;
  const proj = await request(app)
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Quota test project' });
  return { token, projectId: proj.body.project.id };
}

describe('duplicate processing / concurrent job cost controls', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('duplicate upload prevention (checksum)', () => {
    it('rejects re-uploading the exact same video bytes to the same project', async () => {
      const { token, projectId } = await registerAndCreateProject('dup1@example.com');
      const file = writeFixtureCopy(`dup-${Date.now()}.mp4`);

      const first = await request(app)
        .post(`/api/v1/projects/${projectId}/media`)
        .set('Authorization', `Bearer ${token}`)
        .attach('video', file);
      expect(first.status).toBe(202);

      // Same bytes, re-uploaded to the same project — this is exactly the
      // "duplicate processing" case cost controls need to prevent: without
      // it, a user (accidentally or otherwise) doubles their AI/render
      // spend on content that's already been fully processed.
      const second = await request(app)
        .post(`/api/v1/projects/${projectId}/media`)
        .set('Authorization', `Bearer ${token}`)
        .attach('video', file);

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('DUPLICATE_UPLOAD');
    });

    it('allows the exact same video to be uploaded to a different project (checksum check is per-project)', async () => {
      const { token, projectId: projectA } = await registerAndCreateProject('dup2@example.com');
      const projB = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Second project' });
      const projectB = projB.body.project.id;

      const file = writeFixtureCopy(`dup2-${Date.now()}.mp4`);

      const first = await request(app)
        .post(`/api/v1/projects/${projectA}/media`)
        .set('Authorization', `Bearer ${token}`)
        .attach('video', file);
      expect(first.status).toBe(202);

      const second = await request(app)
        .post(`/api/v1/projects/${projectB}/media`)
        .set('Authorization', `Bearer ${token}`)
        .attach('video', file);
      expect(second.status).toBe(202);
    });
  });

  describe('concurrent processing job limit', () => {
    it('rejects starting a new job once the user is at their concurrent-job limit', async () => {
      const { token, projectId } = await registerAndCreateProject('concurrency1@example.com');
      const originalLimit = config.limits.maxProcessingJobsPerUserConcurrent;
      config.limits.maxProcessingJobsPerUserConcurrent = 1;

      try {
        const first = await request(app)
          .post(`/api/v1/projects/${projectId}/media`)
          .set('Authorization', `Bearer ${token}`)
          .attach('video', writeFixtureCopy(`c1a-${Date.now()}.mp4`));
        expect(first.status).toBe(202);

        // The first upload's job is still in an active (non-terminal)
        // state at this point (nothing here has run the worker), so a
        // second upload should be blocked by the concurrent-job quota
        // before it ever gets the chance to enqueue another job.
        const second = await request(app)
          .post(`/api/v1/projects/${projectId}/media`)
          .set('Authorization', `Bearer ${token}`)
          .attach('video', writeFixtureCopy(`c1b-${Date.now()}.mp4`));

        expect(second.status).toBe(429);
        expect(second.body.error.code).toBe('QUOTA_EXCEEDED');
      } finally {
        config.limits.maxProcessingJobsPerUserConcurrent = originalLimit;
      }
    });

    it('allows a new job once the limit is raised (sanity check the limit is actually enforced, not just always-on)', async () => {
      const { token, projectId } = await registerAndCreateProject('concurrency2@example.com');
      const originalLimit = config.limits.maxProcessingJobsPerUserConcurrent;
      config.limits.maxProcessingJobsPerUserConcurrent = 5;

      try {
        const first = await request(app)
          .post(`/api/v1/projects/${projectId}/media`)
          .set('Authorization', `Bearer ${token}`)
          .attach('video', writeFixtureCopy(`c2a-${Date.now()}.mp4`));
        const second = await request(app)
          .post(`/api/v1/projects/${projectId}/media`)
          .set('Authorization', `Bearer ${token}`)
          .attach('video', writeFixtureCopy(`c2b-${Date.now()}.mp4`));

        expect(first.status).toBe(202);
        expect(second.status).toBe(202);
      } finally {
        config.limits.maxProcessingJobsPerUserConcurrent = originalLimit;
      }
    });

    it('does not count another user\'s active jobs against this user\'s limit', async () => {
      const userA = await registerAndCreateProject('concurrency3a@example.com');
      const userB = await registerAndCreateProject('concurrency3b@example.com');
      const originalLimit = config.limits.maxProcessingJobsPerUserConcurrent;
      config.limits.maxProcessingJobsPerUserConcurrent = 1;

      try {
        const aJob = await request(app)
          .post(`/api/v1/projects/${userA.projectId}/media`)
          .set('Authorization', `Bearer ${userA.token}`)
          .attach('video', writeFixtureCopy(`c3a-${Date.now()}.mp4`));
        expect(aJob.status).toBe(202);

        const bJob = await request(app)
          .post(`/api/v1/projects/${userB.projectId}/media`)
          .set('Authorization', `Bearer ${userB.token}`)
          .attach('video', writeFixtureCopy(`c3b-${Date.now()}.mp4`));
        expect(bJob.status).toBe(202);
      } finally {
        config.limits.maxProcessingJobsPerUserConcurrent = originalLimit;
      }
    });
  });
});
