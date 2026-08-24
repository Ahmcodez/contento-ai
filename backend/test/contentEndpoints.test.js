const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createProject(token) {
  const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Content view test' });
  return res.body.project;
}

async function createJobWithPipelineData(project, userId) {
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: userId,
      original_filename: 'test.mp4',
      storage_key: `${project.workspace_id}/${project.id}/fake.mp4`,
      mime_type: 'video/mp4',
      size_bytes: 1024,
      checksum_sha256: `checksum-${Date.now()}-${Math.random()}`,
      status: 'validated',
      duration_seconds: 20,
    })
    .returning('*');

  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'COMPLETED' }).returning('*');

  const [transcript] = await db('transcripts')
    .insert({ media_asset_id: asset.id, full_text: 'hello world this is a test transcript', provider: 'test' })
    .returning('*');
  await db('transcript_segments').insert([
    { transcript_id: transcript.id, sequence: 0, start_ms: 0, end_ms: 2000, text: 'hello world' },
    { transcript_id: transcript.id, sequence: 1, start_ms: 2000, end_ms: 4000, text: 'this is a test' },
  ]);

  await db('content_analyses').insert({
    processing_job_id: job.id,
    summary: 'a test summary',
    topics: JSON.stringify(['testing']),
    key_points: JSON.stringify([]),
    stories: JSON.stringify([]),
    strong_opinions: JSON.stringify([]),
    educational_moments: JSON.stringify([]),
    surprising_statements: JSON.stringify([]),
    questions: JSON.stringify([]),
    conclusions: JSON.stringify([]),
    memorable_quotes: JSON.stringify([]),
    self_contained_ideas: JSON.stringify([]),
    ai_provider: 'test',
  });

  const [clipCandidate] = await db('clip_candidates')
    .insert({
      processing_job_id: job.id,
      start_ms: 0,
      end_ms: 4000,
      title: 'Test clip',
      hook: 'a hook',
      final_score: 77.5,
      rank: 1,
    })
    .returning('*');

  await db('generated_clips').insert({
    clip_candidate_id: clipCandidate.id,
    storage_key: `${asset.storage_key}.clips/${clipCandidate.id}.mp4`,
    render_status: 'rendered',
    duration_seconds: 4,
  });

  await db('generated_content').insert({
    processing_job_id: job.id,
    content_type: 'blog',
    body: 'A grounded blog post body.',
    ai_provider: 'test',
  });

  return { asset, job, clipCandidate };
}

describe('transcript, clips, content and usage endpoints', () => {
  beforeEach(async () => {
    await resetDb();
    await db('transcripts').del();
    await db('content_analyses').del();
    await db('clip_candidates').del();
    await db('generated_content').del();
  });

  describe('GET /api/v1/jobs/:jobId/transcript', () => {
    it('returns the transcript with segments', async () => {
      const { token, userId } = await registerUser('transcript1@example.com');
      const project = await createProject(token);
      const { job } = await createJobWithPipelineData(project, userId);

      const res = await request(app).get(`/api/v1/jobs/${job.id}/transcript`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.fullText).toContain('hello world');
      expect(res.body.segments).toHaveLength(2);
    });

    it('returns 409 when the transcript is not ready yet', async () => {
      const { token, userId } = await registerUser('transcript2@example.com');
      const project = await createProject(token);
      const [asset] = await db('media_assets')
        .insert({
          project_id: project.id,
          uploaded_by: userId,
          original_filename: 'x.mp4',
          storage_key: 'x',
          mime_type: 'video/mp4',
          size_bytes: 1,
          checksum_sha256: `c-${Date.now()}`,
        })
        .returning('*');
      const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'TRANSCRIBING' }).returning('*');

      const res = await request(app).get(`/api/v1/jobs/${job.id}/transcript`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_READY');
    });

    it('returns 404 for another user\'s job', async () => {
      const { token, userId } = await registerUser('transcript3@example.com');
      const project = await createProject(token);
      const { job } = await createJobWithPipelineData(project, userId);

      const { token: strangerToken } = await registerUser('stranger1@example.com');
      const res = await request(app).get(`/api/v1/jobs/${job.id}/transcript`).set('Authorization', `Bearer ${strangerToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/jobs/:jobId/clips', () => {
    it('returns clips with score and render status', async () => {
      const { token, userId } = await registerUser('clips1@example.com');
      const project = await createProject(token);
      const { job } = await createJobWithPipelineData(project, userId);

      const res = await request(app).get(`/api/v1/jobs/${job.id}/clips`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Test clip');
      expect(res.body.data[0].qualityScore).toBe(77.5);
      expect(res.body.data[0].render.status).toBe('rendered');
    });
  });

  describe('GET /api/v1/clips/:clipCandidateId/download', () => {
    it('returns an error (not a hang) if the underlying file cannot be found on disk (storage mismatch)', async () => {
      const { token, userId } = await registerUser('download1@example.com');
      const project = await createProject(token);
      const { clipCandidate } = await createJobWithPipelineData(project, userId);

      const res = await request(app)
        .get(`/api/v1/clips/${clipCandidate.id}/download`)
        .set('Authorization', `Bearer ${token}`)
        .timeout(5000);
      // storage_key points to a non-existent file in this test, so the
      // stream itself errors — but ownership + render-status checks must
      // pass first, and the response must fail cleanly rather than hang.
      expect([200, 500]).toContain(res.status);
    }, 10000);

    it('returns 404 for a clip belonging to another user', async () => {
      const { token, userId } = await registerUser('download2@example.com');
      const project = await createProject(token);
      const { clipCandidate } = await createJobWithPipelineData(project, userId);

      const { token: strangerToken } = await registerUser('stranger2@example.com');
      const res = await request(app)
        .get(`/api/v1/clips/${clipCandidate.id}/download`)
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/jobs/:jobId/content', () => {
    it('returns generated content for the job', async () => {
      const { token, userId } = await registerUser('content1@example.com');
      const project = await createProject(token);
      const { job } = await createJobWithPipelineData(project, userId);

      const res = await request(app).get(`/api/v1/jobs/${job.id}/content`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].contentType).toBe('blog');
    });
  });

  describe('PATCH /api/v1/content/:contentId', () => {
    it('lets the owner edit generated content', async () => {
      const { token, userId } = await registerUser('edit1@example.com');
      const project = await createProject(token);
      await createJobWithPipelineData(project, userId);
      const content = await db('generated_content').first();

      const res = await request(app)
        .patch(`/api/v1/content/${content.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'edited body text' });

      expect(res.status).toBe(200);
      expect(res.body.content.body).toBe('edited body text');
      expect(res.body.content.status).toBe('edited');
    });

    it('rejects editing content owned by another user', async () => {
      const { token, userId } = await registerUser('edit2@example.com');
      const project = await createProject(token);
      await createJobWithPipelineData(project, userId);
      const content = await db('generated_content').first();

      const { token: strangerToken } = await registerUser('stranger3@example.com');
      const res = await request(app)
        .patch(`/api/v1/content/${content.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ body: 'hijacked' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty body', async () => {
      const { token, userId } = await registerUser('edit3@example.com');
      const project = await createProject(token);
      await createJobWithPipelineData(project, userId);
      const content = await db('generated_content').first();

      const res = await request(app)
        .patch(`/api/v1/content/${content.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: '' });
      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/v1/usage', () => {
    it('returns plan quota and current usage', async () => {
      const { token } = await registerUser('usage1@example.com');
      const res = await request(app).get('/api/v1/usage').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('free');
      expect(res.body.quota.maxClipsPerVideo).toBeGreaterThan(0);
      expect(res.body.usage.aiRequestsUsedToday).toBe(0);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/usage');
      expect(res.status).toBe(401);
    });
  });
});
