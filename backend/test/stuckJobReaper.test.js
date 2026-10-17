const db = require('../src/db/client');
const redis = require('../src/redis/client');
const config = require('../src/config');
const { PHYSICAL_QUEUES, QUEUE_NAMES, getQueue, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');
const reaper = require('../src/workers/stuckJobReaper');

const STALE = () => new Date(Date.now() - 10 * 60 * 1000); // well past REAPER_STUCK_AFTER_MS
const FRESH = () => new Date();

async function clearQueues() {
  for (const name of Object.values(PHYSICAL_QUEUES)) {
    // eslint-disable-next-line no-await-in-loop
    await getPhysicalQueue(name).obliterate({ force: true });
  }
}

async function seedProject() {
  const [user] = await db('users').insert({ email: `reaper-${Date.now()}-${Math.random()}@example.com`, password_hash: 'x' }).returning('*');
  const [workspace] = await db('workspaces').insert({ name: 'ws', owner_id: user.id }).returning('*');
  const [project] = await db('projects').insert({ workspace_id: workspace.id, title: 'p', created_by: user.id }).returning('*');
  return { user, project };
}

async function seedPipelineJob(state, { updatedAt = STALE() } = {}) {
  const { user, project } = await seedProject();
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: user.id,
      original_filename: 'a.mp4',
      storage_key: `${project.workspace_id}/${project.id}/ULID123.mp4`,
      mime_type: 'video/mp4',
      size_bytes: 10,
      checksum_sha256: `c-${Math.random()}`,
      status: 'validated',
    })
    .returning('*');
  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state, updated_at: updatedAt }).returning('*');
  return { user, project, asset, job };
}

async function seedImport(state, { updatedAt = STALE() } = {}) {
  const { user, project } = await seedProject();
  const [row] = await db('media_imports')
    .insert({ project_id: project.id, requested_by: user.id, source_url: 'https://example.com/v.mp4', state, updated_at: updatedAt })
    .returning('*');
  return row;
}

const jobsIn = async (queueName) => getPhysicalQueue(queueName).getJobs(['waiting', 'delayed', 'active', 'prioritized']);
const stateOf = async (table, id) => (await db(table).where({ id }).first()).state;

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  await redis.del('reaper:lock');
});

afterAll(async () => {
  await clearQueues();
  await closeAllQueues();
});

describe('stuck job reaper: pipeline jobs', () => {
  test('re-enqueues the next stage when state moved on but the job was never added', async () => {
    const { job, asset } = await seedPipelineJob('AUDIO_EXTRACTED');

    const result = await reaper.sweep();

    expect(result).toMatchObject({ examined: 1, requeued: 1, failed: 0 });
    const queued = await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION);
    expect(queued).toHaveLength(1);
    expect(queued[0].name).toBe('transcription.process');
    expect(queued[0].data).toEqual({
      processingJobId: job.id,
      mediaAssetId: asset.id,
      audioStorageKey: asset.storage_key.replace('.mp4', '.audio.wav'),
    });
    expect(queued[0].opts.attempts).toBe(4); // normal per-stage retry policy applies
    const events = await db('processing_job_events').where({ processing_job_id: job.id });
    expect(events.map((e) => e.metadata)).toContainEqual({ reaper: 'requeued', stage: QUEUE_NAMES.TRANSCRIPTION_PROCESS, attempt: 1 });
  });

  test('rebuilds clip.render payload with candidate ids in rank order', async () => {
    const { job, asset } = await seedPipelineJob('RENDERING_CLIPS');
    const [second, first] = await db('clip_candidates')
      .insert([
        { processing_job_id: job.id, start_ms: 40000, end_ms: 70000, title: 'b', final_score: 70, rank: 2 },
        { processing_job_id: job.id, start_ms: 0, end_ms: 30000, title: 'a', final_score: 90, rank: 1 },
      ])
      .returning('*');

    await reaper.sweep();

    const queued = await jobsIn(PHYSICAL_QUEUES.RENDER);
    expect(queued).toHaveLength(1);
    expect(queued[0].data).toEqual({ processingJobId: job.id, mediaAssetId: asset.id, clipCandidateIds: [first.id, second.id] });
  });

  test.each(Object.entries(reaper.PIPELINE_STATE_TO_STAGE))('%s maps to a stage that can be enqueued', async (state, stage) => {
    const { job } = await seedPipelineJob(state);
    const result = await reaper.sweep();
    expect(result.requeued).toBe(1);
    const queued = await jobsIn(require('../src/queue/queues').STAGE_TO_QUEUE[stage]);
    expect(queued.map((j) => j.data.processingJobId)).toEqual([job.id]);
  });

  test('leaves a job alone when a live queue job already exists', async () => {
    const { job, asset } = await seedPipelineJob('TRANSCRIBING');
    await getQueue(QUEUE_NAMES.TRANSCRIPTION_PROCESS).add(
      'transcription.process',
      { processingJobId: job.id, mediaAssetId: asset.id, audioStorageKey: 'x' },
      { delay: 60000 }, // e.g. waiting out a retry backoff
    );

    const result = await reaper.sweep();

    expect(result).toMatchObject({ examined: 1, requeued: 0, failed: 0, skipped: 1 });
    expect(await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).toHaveLength(1);
    expect(await db('processing_job_events').where({ processing_job_id: job.id })).toHaveLength(0);
  });

  test('a live job for a different pipeline job does not hide a stuck one', async () => {
    const stuck = await seedPipelineJob('AUDIO_EXTRACTED');
    const other = await seedPipelineJob('AUDIO_EXTRACTED', { updatedAt: FRESH() });
    await getQueue(QUEUE_NAMES.TRANSCRIPTION_PROCESS).add('transcription.process', {
      processingJobId: other.job.id,
      mediaAssetId: other.asset.id,
      audioStorageKey: 'x',
    });

    const result = await reaper.sweep();

    expect(result.requeued).toBe(1);
    const ids = (await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).map((j) => j.data.processingJobId).sort();
    expect(ids).toEqual([stuck.job.id, other.job.id].sort());
  });

  test('does not touch recently updated, terminal, or still-uploading jobs', async () => {
    await seedPipelineJob('EXTRACTING_AUDIO', { updatedAt: FRESH() });
    await seedPipelineJob('COMPLETED');
    await seedPipelineJob('FAILED');
    await seedPipelineJob('CANCELLED');
    await seedPipelineJob('UPLOADING');

    const result = await reaper.sweep();

    expect(result).toEqual({ examined: 0, requeued: 0, failed: 0, skipped: 0 });
    for (const name of Object.values(PHYSICAL_QUEUES)) {
      // eslint-disable-next-line no-await-in-loop
      expect(await jobsIn(name)).toHaveLength(0);
    }
  });

  test('fails the job with an honest message once re-enqueues are used up', async () => {
    const { job } = await seedPipelineJob('TRANSCRIBING');
    const max = config.reaper.maxRequeuesPerStage;

    for (let i = 0; i < max; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await reaper.sweep()).requeued).toBe(1);
      // simulate the re-enqueued job vanishing again and time passing
      // eslint-disable-next-line no-await-in-loop
      await clearQueues();
      // eslint-disable-next-line no-await-in-loop
      await db('processing_jobs').where({ id: job.id }).update({ updated_at: STALE() });
    }

    const final = await reaper.sweep();

    expect(final).toMatchObject({ requeued: 0, failed: 1 });
    const row = await db('processing_jobs').where({ id: job.id }).first();
    expect(row.state).toBe('FAILED');
    expect(row.failure_stage).toBe('TRANSCRIBING');
    expect(row.error_message).toBe(reaper.INTERRUPTED_MESSAGE);
    expect(row.completed_at).not.toBeNull();
    const errors = await db('processing_errors').where({ processing_job_id: job.id });
    expect(errors).toHaveLength(1);
    expect(errors[0].stage).toBe('TRANSCRIBING');
    expect(await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).toHaveLength(0);
  });

  test('the re-enqueue allowance is per stage, not per job lifetime', async () => {
    const { job } = await seedPipelineJob('AUDIO_EXTRACTED');
    // Used up its allowance in an earlier stage...
    for (let i = 1; i <= config.reaper.maxRequeuesPerStage; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await db('processing_job_events').insert({
        processing_job_id: job.id,
        from_state: 'VALIDATED',
        to_state: 'VALIDATED',
        metadata: JSON.stringify({ reaper: 'requeued', attempt: i }),
      });
    }

    // ...must not count against this one.
    expect((await reaper.sweep()).requeued).toBe(1);
  });

  test('two reapers sweeping at once enqueue exactly one job', async () => {
    const { job } = await seedPipelineJob('AUDIO_EXTRACTED');

    await Promise.all([reaper.sweep(), reaper.sweep(), reaper.sweep()]);

    const queued = await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION);
    expect(queued.filter((j) => j.data.processingJobId === job.id)).toHaveLength(1);
    const events = await db('processing_job_events').where({ processing_job_id: job.id });
    expect(events).toHaveLength(1);
  });

  test('does nothing when Redis cannot be read (unknown is not dead)', async () => {
    const { job } = await seedPipelineJob('AUDIO_EXTRACTED');
    const spy = jest.spyOn(getPhysicalQueue(PHYSICAL_QUEUES.TRANSCRIPTION), 'getJobs').mockRejectedValue(new Error('redis down'));

    const result = await reaper.sweep();
    spy.mockRestore();

    expect(result).toMatchObject({ requeued: 0, failed: 0, skipped: 1 });
    expect(await stateOf('processing_jobs', job.id)).toBe('AUDIO_EXTRACTED');
    expect(await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION)).toHaveLength(0);
  });

  test('a re-enqueued job that then runs is not touched on the next sweep', async () => {
    await seedPipelineJob('AUDIO_EXTRACTED');
    await reaper.sweep();
    // claim bumped updated_at, so the row is no longer stale
    expect((await reaper.sweep()).examined).toBe(0);
  });
});

describe('stuck job reaper: URL imports', () => {
  test('re-enqueues resolve for a stuck DETECTING_PROVIDER import', async () => {
    const row = await seedImport('DETECTING_PROVIDER');
    await reaper.sweep();
    const queued = await jobsIn(PHYSICAL_QUEUES.LIGHT);
    expect(queued.map((j) => [j.name, j.data])).toEqual([['url-import.resolve', { mediaImportId: row.id }]]);
  });

  test('re-enqueues download for a stuck DOWNLOADING import', async () => {
    const row = await seedImport('DOWNLOADING');
    await reaper.sweep();
    const queued = await jobsIn(PHYSICAL_QUEUES.DOWNLOAD);
    expect(queued.map((j) => [j.name, j.data])).toEqual([['url-import.download', { mediaImportId: row.id }]]);
  });

  test('fails a stuck VALIDATING_MEDIA import instead of re-running the download', async () => {
    const row = await seedImport('VALIDATING_MEDIA');
    const result = await reaper.sweep();
    expect(result.failed).toBe(1);
    const after = await db('media_imports').where({ id: row.id }).first();
    expect(after.state).toBe('FAILED');
    expect(after.failure_stage).toBe('VALIDATING_MEDIA');
    expect(after.error_message).toBe(reaper.INTERRUPTED_MESSAGE);
    expect(await jobsIn(PHYSICAL_QUEUES.DOWNLOAD)).toHaveLength(0);
  });

  test('leaves WAITING_CONFIRMATION alone (that is waiting on the user, not a queue)', async () => {
    const row = await seedImport('WAITING_CONFIRMATION');
    const result = await reaper.sweep();
    expect(result.examined).toBe(0);
    expect(await stateOf('media_imports', row.id)).toBe('WAITING_CONFIRMATION');
  });

  test('fails an import after the allowance is used up', async () => {
    const row = await seedImport('DOWNLOADING');
    for (let i = 0; i < config.reaper.maxRequeuesPerStage; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await reaper.sweep();
      // eslint-disable-next-line no-await-in-loop
      await clearQueues();
      // eslint-disable-next-line no-await-in-loop
      await db('media_imports').where({ id: row.id }).update({ updated_at: STALE() });
    }
    expect((await reaper.sweep()).failed).toBe(1);
    expect(await stateOf('media_imports', row.id)).toBe('FAILED');
  });
});

describe('startReaper', () => {
  test('sweeps on its timer and stops cleanly', async () => {
    const { job } = await seedPipelineJob('AUDIO_EXTRACTED');
    const handle = reaper.startReaper({ intervalMs: 50, firstRunDelayMs: 10 });

    const deadline = Date.now() + 5000;
    let queued = [];
    while (Date.now() < deadline && queued.length === 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50));
      // eslint-disable-next-line no-await-in-loop
      queued = await jobsIn(PHYSICAL_QUEUES.TRANSCRIPTION);
    }
    handle.stop();

    expect(queued.map((j) => j.data.processingJobId)).toEqual([job.id]);
  });
});
