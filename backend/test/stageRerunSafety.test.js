const db = require('../src/db/client');
const transcriptRepository = require('../src/repositories/transcript.repository');
const contentAnalysisRepository = require('../src/repositories/contentAnalysis.repository');
const clipCandidateRepository = require('../src/repositories/clipCandidate.repository');

// A pipeline stage can run twice for the same job (BullMQ retry after a crash
// past the persist step, or a stuck-job reaper re-enqueue). These pin down that
// the second run replaces the first instead of dying on a unique constraint or
// piling up duplicates.

async function seedJob() {
  const [user] = await db('users').insert({ email: `rerun-${Date.now()}-${Math.random()}@example.com`, password_hash: 'x' }).returning('*');
  const [workspace] = await db('workspaces').insert({ name: 'ws', owner_id: user.id }).returning('*');
  const [project] = await db('projects').insert({ workspace_id: workspace.id, title: 'p', created_by: user.id }).returning('*');
  const [asset] = await db('media_assets')
    .insert({
      project_id: project.id,
      uploaded_by: user.id,
      original_filename: 'a.mp4',
      storage_key: 'k/a.mp4',
      mime_type: 'video/mp4',
      size_bytes: 10,
      checksum_sha256: `c-${Math.random()}`,
      status: 'validated',
    })
    .returning('*');
  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'TRANSCRIBING' }).returning('*');
  return { asset, job };
}

describe('stage persistence is safe to run twice', () => {
  beforeEach(async () => {
    await resetDb();
  });

  test('transcript: second persist replaces the first', async () => {
    const { asset } = await seedJob();
    const base = { mediaAssetId: asset.id, language: 'en', provider: 'groq' };
    await transcriptRepository.create({ ...base, fullText: 'first', segments: [{ startMs: 0, endMs: 1000, text: 'first' }] });
    await transcriptRepository.create({
      ...base,
      fullText: 'second',
      segments: [
        { startMs: 0, endMs: 500, text: 'sec' },
        { startMs: 500, endMs: 1000, text: 'ond' },
      ],
    });

    const transcripts = await db('transcripts').where({ media_asset_id: asset.id });
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0].full_text).toBe('second');
    const segments = await transcriptRepository.findSegments(transcripts[0].id);
    expect(segments.map((s) => s.text)).toEqual(['sec', 'ond']);
  });

  test('content analysis: second persist overwrites the first', async () => {
    const { job } = await seedJob();
    await contentAnalysisRepository.create({ processingJobId: job.id, analysis: { summary: 'one', topics: ['a'] }, aiProvider: 'Gemini' });
    await contentAnalysisRepository.create({ processingJobId: job.id, analysis: { summary: 'two', topics: ['b'] }, aiProvider: 'Gemini' });

    const rows = await db('content_analyses').where({ processing_job_id: job.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe('two');
  });

  test('clip candidates: second detection replaces the first batch', async () => {
    const { job } = await seedJob();
    const mk = (title, startMs) => ({ startMs, endMs: startMs + 30000, title, finalScore: 80 });
    await clipCandidateRepository.createMany(job.id, [mk('old 1', 0), mk('old 2', 40000)]);
    await clipCandidateRepository.createMany(job.id, [mk('new 1', 0)]);

    const rows = await clipCandidateRepository.listByProcessingJobId(job.id);
    expect(rows.map((r) => r.title)).toEqual(['new 1']);
  });

  test('clip candidates: a candidate that already has a rendered clip is kept', async () => {
    const { job } = await seedJob();
    const [kept] = await clipCandidateRepository.createMany(job.id, [{ startMs: 0, endMs: 30000, title: 'rendered', finalScore: 90 }]);
    await db('generated_clips').insert({ clip_candidate_id: kept.id, render_status: 'rendered' });

    await clipCandidateRepository.createMany(job.id, [{ startMs: 50000, endMs: 80000, title: 'fresh', finalScore: 70 }]);

    const titles = (await clipCandidateRepository.listByProcessingJobId(job.id)).map((r) => r.title).sort();
    expect(titles).toEqual(['fresh', 'rendered']);
  });
});
