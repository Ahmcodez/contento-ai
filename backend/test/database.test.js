const db = require('../src/db/client');

/**
 * These tests exercise real schema-level guarantees (FK cascade
 * behavior, check constraints) directly against Postgres — not through
 * the API layer — because that's the only way to prove the database
 * itself enforces them, independent of whatever application code happens
 * to call it today.
 */
describe('database constraints and cascade behavior', () => {
  let user;
  let workspace;
  let project;

  beforeEach(async () => {
    await resetDb();
    [user] = await db('users').insert({ email: `dbtest-${Date.now()}@example.com`, password_hash: 'x' }).returning('*');
    [workspace] = await db('workspaces').insert({ owner_id: user.id, name: 'ws' }).returning('*');
    [project] = await db('projects').insert({ workspace_id: workspace.id, title: 'p', created_by: user.id }).returning('*');
  });

  afterAll(async () => {
    await db('usage_records').del();
  });

  it('deletes usage_records.processing_job_id gracefully (sets null) when the job is deleted, instead of blocking the delete', async () => {
    const [asset] = await db('media_assets')
      .insert({
        project_id: project.id,
        uploaded_by: user.id,
        original_filename: 'x.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: `cascade-${Date.now()}`,
      })
      .returning('*');
    const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'COMPLETED' }).returning('*');
    await db('usage_records').insert({
      user_id: user.id,
      category: 'ai_requests',
      amount: 1,
      processing_job_id: job.id,
      occurred_on: '2020-01-01',
    });

    // media_assets cascades to processing_jobs; this must not throw.
    await expect(db('media_assets').where({ id: asset.id }).del()).resolves.toBeDefined();

    const remaining = await db('usage_records').where({ user_id: user.id, occurred_on: '2020-01-01' });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].processing_job_id).toBeNull();
  });

  it('cascades project deletion down to media assets and processing jobs', async () => {
    const [asset] = await db('media_assets')
      .insert({
        project_id: project.id,
        uploaded_by: user.id,
        original_filename: 'x.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: `cascade2-${Date.now()}`,
      })
      .returning('*');
    await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'UPLOADED' });

    await db('projects').where({ id: project.id }).del();

    expect(await db('media_assets').where({ id: asset.id }).first()).toBeUndefined();
  });

  it('rejects a transcript_segment where end_ms is not after start_ms', async () => {
    const [asset] = await db('media_assets')
      .insert({
        project_id: project.id,
        uploaded_by: user.id,
        original_filename: 'x.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: `check-${Date.now()}`,
      })
      .returning('*');
    const [transcript] = await db('transcripts')
      .insert({ media_asset_id: asset.id, full_text: 'x', provider: 'test' })
      .returning('*');

    await expect(
      db('transcript_segments').insert({
        transcript_id: transcript.id,
        sequence: 0,
        start_ms: 1000,
        end_ms: 500,
        text: 'invalid',
      }),
    ).rejects.toThrow();
  });

  it('rejects a clip_candidate where end_ms is not after start_ms', async () => {
    const [asset] = await db('media_assets')
      .insert({
        project_id: project.id,
        uploaded_by: user.id,
        original_filename: 'x.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: `check2-${Date.now()}`,
      })
      .returning('*');
    const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'CLIPS_FOUND' }).returning('*');

    await expect(
      db('clip_candidates').insert({
        processing_job_id: job.id,
        start_ms: 5000,
        end_ms: 1000,
        title: 'bad',
        final_score: 50,
        rank: 1,
      }),
    ).rejects.toThrow();
  });

  it('rejects a negative size_bytes on media_assets', async () => {
    await expect(
      db('media_assets').insert({
        project_id: project.id,
        uploaded_by: user.id,
        original_filename: 'x.mp4',
        storage_key: 'x',
        mime_type: 'video/mp4',
        size_bytes: -1,
        checksum_sha256: `neg-${Date.now()}`,
      }),
    ).rejects.toThrow();
  });

  it('enforces one workspace membership per user per workspace', async () => {
    await db('workspace_members').insert({ workspace_id: workspace.id, user_id: user.id, role: 'editor' }).catch(() => {});
    // the beforeEach personal workspace flow doesn't insert a membership
    // directly in this test setup, so insert the first membership here.
    const membershipExists = await db('workspace_members').where({ workspace_id: workspace.id, user_id: user.id }).first();
    if (!membershipExists) {
      await db('workspace_members').insert({ workspace_id: workspace.id, user_id: user.id, role: 'owner' });
    }
    await expect(
      db('workspace_members').insert({ workspace_id: workspace.id, user_id: user.id, role: 'viewer' }),
    ).rejects.toThrow();
  });
});
