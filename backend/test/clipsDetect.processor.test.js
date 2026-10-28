const db = require('../src/db/client');
const { PHYSICAL_QUEUES, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');
const transcriptRepository = require('../src/repositories/transcript.repository');
const contentAnalysisRepository = require('../src/repositories/contentAnalysis.repository');

// Detection must never need the model when the analysis already proposed clips. Any call is a failure.
jest.mock('../src/ai', () => ({
  getAIProvider: () => ({
    constructor: { name: 'ForbiddenProvider' },
    generateStructuredOutput: () => {
      throw new Error('clip detection called the AI even though analysis had proposals');
    },
  }),
}));
const processClipsDetect = require('../src/workers/processors/clipsDetect.processor');

const SEG_MS = 6000;
const HOOK_LINE = 'Well you know it was a long day. Most people get this backwards and it costs them years.';
const text = (i) => (i === 14 ? HOOK_LINE : `Statement ${i} continues with enough extra words to make it a full line of speech.`);

/** 200 segments (20 minutes) with word timestamps, saved through the real repository. */
const segments = Array.from({ length: 200 }, (_, i) => {
  const t = text(i);
  const parts = t.split(' ');
  const step = 5800 / parts.length;
  return {
    startMs: i * SEG_MS,
    endMs: i * SEG_MS + 5800,
    text: t,
    wordTimestamps: parts.map((word, k) => ({ word, startMs: Math.round(i * SEG_MS + k * step), endMs: Math.round(i * SEG_MS + (k + 1) * step) })),
  };
});

const proposal = (startLine, endLine, hook) => ({ startLine, endLine, hook, title: `Clip ${startLine}`, score: 80 });

async function seedJob({ requestedClipCount, proposals }) {
  const [user] = await db('users').insert({ email: `cd-${Date.now()}-${Math.random()}@example.com`, password_hash: 'x' }).returning('*');
  const [ws] = await db('workspaces').insert({ name: 'w', owner_id: user.id }).returning('*');
  const [project] = await db('projects').insert({ workspace_id: ws.id, title: 'p', created_by: user.id }).returning('*');
  const [asset] = await db('media_assets')
    .insert({ project_id: project.id, uploaded_by: user.id, original_filename: 'a.mp4', storage_key: 'k', mime_type: 'video/mp4', size_bytes: 1, checksum_sha256: `c${Math.random()}`, status: 'validated', duration_seconds: 1200 })
    .returning('*');
  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'ANALYZED', requested_clip_count: requestedClipCount }).returning('*');
  await transcriptRepository.create({ mediaAssetId: asset.id, fullText: segments.map((s) => s.text).join(' '), language: 'en', provider: 'groq', segments });
  await contentAnalysisRepository.create({ processingJobId: job.id, analysis: { summary: 's', topics: [], clips: proposals }, aiProvider: 'Mock' });
  return { user, asset, job };
}
const run = ({ job, asset }) => processClipsDetect({ data: { processingJobId: job.id, mediaAssetId: asset.id } });

beforeEach(async () => {
  await resetDb();
  await getPhysicalQueue(PHYSICAL_QUEUES.RENDER).obliterate({ force: true });
});
afterAll(async () => {
  await getPhysicalQueue(PHYSICAL_QUEUES.RENDER).obliterate({ force: true });
  await closeAllQueues();
});

describe('clips.detect stage, against real stored data', () => {
  it('starts the clip on the hook word read back from the database, and ends where the explanation ends', async () => {
    const seeded = await seedJob({ requestedClipCount: 3, proposals: [proposal(14, 22, 'Most people get this backwards')] });
    await run(seeded);

    const [clip] = await db('clip_candidates').where({ processing_job_id: seeded.job.id });
    const hookWord = segments[14].wordTimestamps.find((w) => w.word === 'Most');
    expect(clip.start_ms).toBe(hookWord.startMs - 200); // not the start of the line, which begins with "Well you know..."
    expect(clip.hook).toBe('Most people get this backwards');
    const endsAtLine22 = segments[22].endMs;
    expect(clip.end_ms).toBeGreaterThanOrEqual(endsAtLine22);
    expect(clip.end_ms).toBeLessThanOrEqual(endsAtLine22 + 400);
    expect(clip.score_breakdown).toEqual(expect.objectContaining({ hookPresence: expect.any(Number) }));
  });

  it('delivers the number the user asked for, spread over the video, and hands them to the renderer in rank order', async () => {
    const starts = [10, 30, 55, 80, 100, 120, 150, 180];
    const seeded = await seedJob({ requestedClipCount: 4, proposals: starts.map((s) => proposal(s, s + 8, `Statement ${s} continues with`)) });
    await run(seeded);

    const rows = await db('clip_candidates').where({ processing_job_id: seeded.job.id }).orderBy('rank');
    expect(rows).toHaveLength(4);
    const quarter = 1200000 / 4;
    expect(new Set(rows.map((r) => Math.floor(((r.start_ms + r.end_ms) / 2) / quarter))).size).toBe(4);

    const job = await db('processing_jobs').where({ id: seeded.job.id }).first();
    expect(job.state).toBe('CLIPS_SCORED');
    const events = await db('processing_job_events').where({ processing_job_id: seeded.job.id, to_state: 'CLIPS_FOUND' });
    expect(events[0].metadata).toMatchObject({ requestedClipCount: 4, candidateCount: 4, source: 'analysis' });

    const [queued] = await getPhysicalQueue(PHYSICAL_QUEUES.RENDER).getJobs(['waiting']);
    expect(queued.data.clipCandidateIds).toEqual(rows.map((r) => r.id));
  });

  it('records the shortfall when fewer strong clips exist than were asked for', async () => {
    const seeded = await seedJob({ requestedClipCount: 8, proposals: [proposal(10, 18, 'Statement 10 continues with'), proposal(100, 108, 'Statement 100 continues with')] });
    await run(seeded);

    expect(await db('clip_candidates').where({ processing_job_id: seeded.job.id })).toHaveLength(2);
    const events = await db('processing_job_events').where({ processing_job_id: seeded.job.id, to_state: 'CLIPS_FOUND' });
    expect(events[0].metadata).toMatchObject({ requestedClipCount: 8, candidateCount: 2 });
  });

  it('uses the default count for a job created before the choice existed', async () => {
    const proposals = Array.from({ length: 12 }, (_, i) => proposal(5 + i * 15, 13 + i * 15, `Statement ${5 + i * 15} continues with`));
    const seeded = await seedJob({ requestedClipCount: null, proposals });
    await run(seeded);
    expect(await db('clip_candidates').where({ processing_job_id: seeded.job.id })).toHaveLength(require('../src/config').limits.defaultClipsPerVideo);
  });

  it('can be run twice (retry / reaper re-enqueue) without piling up duplicate clips', async () => {
    const seeded = await seedJob({ requestedClipCount: 2, proposals: [proposal(10, 18, 'Statement 10 continues with'), proposal(100, 108, 'Statement 100 continues with')] });
    await run(seeded);
    await db('processing_jobs').where({ id: seeded.job.id }).update({ state: 'ANALYZED' });
    await run(seeded);
    expect(await db('clip_candidates').where({ processing_job_id: seeded.job.id })).toHaveLength(2);
  });
});
