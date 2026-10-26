const db = require('../src/db/client');
const { detectClips, persistClips } = require('../src/services/clipDetection.service');
const { buildTimedLines } = require('../src/transcript/timed');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT } = require('../src/ai/promptSafety');

const text = (i) => `Statement ${i} continues with enough extra words to make it a full line of speech.`;
const makeTranscript = (count) => ({
  durationMs: count * 6000,
  segments: Array.from({ length: count }, (_, i) => ({ startMs: i * 6000, endMs: i * 6000 + 5800, text: text(i) })),
});
const proposal = (startLine, endLine, extra = {}) => ({ startLine, endLine, hook: `Statement ${startLine} continues with`, title: `Clip ${startLine}`, score: 80, ...extra });
const spyProvider = (data = { clips: [] }) => ({ generateStructuredOutput: jest.fn(async () => ({ data, usage: {} })), generateText: jest.fn() });

// A 40-minute video (400 lines) with proposals bunched at the start and a few later.
const TRANSCRIPT = makeTranscript(400);

describe('detectClips: the normal path makes no AI call', () => {
  it('builds the clips from the proposals the analysis already made, without touching the provider', async () => {
    const provider = spyProvider();
    const analysis = { clips: [proposal(10, 20), proposal(120, 130), proposal(240, 250), proposal(330, 340)] };

    const { candidates, source, proposalCount } = await detectClips({ provider, transcript: TRANSCRIPT, analysis, requestedClipCount: 3, userId: null, processingJobId: null });

    expect(provider.generateStructuredOutput).not.toHaveBeenCalled();
    expect(source).toBe('analysis');
    expect(proposalCount).toBe(4);
    expect(candidates).toHaveLength(3);
  });

  it('returns the number requested, spread over the video, each starting on its hook line', async () => {
    const analysis = { clips: [10, 30, 60, 130, 200, 260, 320, 380].map((s) => proposal(s, s + 9)) };
    const { candidates } = await detectClips({ provider: spyProvider(), transcript: TRANSCRIPT, analysis, requestedClipCount: 4, userId: null, processingJobId: null });

    expect(candidates).toHaveLength(4);
    const quarter = TRANSCRIPT.durationMs / 4;
    expect(new Set(candidates.map((c) => Math.floor(((c.startMs + c.endMs) / 2) / quarter))).size).toBe(4);
    const lines = buildTimedLines(TRANSCRIPT.segments);
    for (const c of candidates) {
      expect(c.startMs).toBe(lines[c.startLine].startMs); // hook is the first words of its line here
      expect(c.hookVerified).toBe(true);
      expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(15000);
    }
  });

  it('gives back fewer than requested (never junk, never an error) when there are not enough strong clips', async () => {
    const analysis = { clips: [proposal(10, 20), proposal(200, 210)] };
    const { candidates } = await detectClips({ provider: spyProvider(), transcript: TRANSCRIPT, analysis, requestedClipCount: 8, userId: null, processingJobId: null });
    expect(candidates.length).toBeLessThanOrEqual(2);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('defaults the count when none is given', async () => {
    const analysis = { clips: Array.from({ length: 12 }, (_, i) => proposal(i * 30 + 5, i * 30 + 14)) };
    const { candidates } = await detectClips({ provider: spyProvider(), transcript: TRANSCRIPT, analysis, userId: null, processingJobId: null });
    expect(candidates).toHaveLength(require('../src/config').limits.defaultClipsPerVideo);
  });
});

describe('detectClips: fallback', () => {
  it('asks the model only when the analysis left no usable proposals, and still answers in line ids', async () => {
    const small = makeTranscript(100); // fits in one chunk
    const provider = spyProvider({ clips: [proposal(10, 20), proposal(70, 80)] });

    const { candidates, source } = await detectClips({ provider, transcript: small, analysis: { clips: [] }, requestedClipCount: 2, userId: null, processingJobId: null });

    expect(source).toBe('fallback');
    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(1);
    const call = provider.generateStructuredOutput.mock.calls[0][0];
    expect(call.systemPrompt).toBe(UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT);
    expect(call.prompt).toMatch(/<transcript>[\s\S]*\[0\] Statement 0[\s\S]*<\/transcript>/);
    expect(call.prompt).toMatch(/START at the line where the HOOK is first spoken/);
    expect(candidates).toHaveLength(2);
  });

  it('on a long video makes one call per chunk (never one giant prompt) and merges the results', async () => {
    const provider = spyProvider({ clips: [proposal(40, 50), proposal(300, 310)] });
    const { candidates } = await detectClips({ provider, transcript: TRANSCRIPT, analysis: { clips: [] }, requestedClipCount: 2, userId: null, processingJobId: null });
    expect(provider.generateStructuredOutput.mock.calls.length).toBeGreaterThan(1);
    expect(candidates).toHaveLength(2); // duplicates from the repeated proposals collapse (overlapping clips are never both kept)
  });

  it('falls back when every stored proposal points at nothing usable', async () => {
    const provider = spyProvider({ clips: [proposal(100, 110)] });
    const { source, candidates } = await detectClips({ provider, transcript: TRANSCRIPT, analysis: { clips: [proposal(9000, 9010)] }, requestedClipCount: 1, userId: null, processingJobId: null });
    expect(source).toBe('fallback');
    expect(candidates).toHaveLength(1);
  });

  it('reports an empty result, not an error, when the model finds nothing either', async () => {
    const { candidates, source } = await detectClips({ provider: spyProvider({ clips: [] }), transcript: TRANSCRIPT, analysis: {}, requestedClipCount: 3, userId: null, processingJobId: null });
    expect(candidates).toEqual([]);
    expect(source).toBe('fallback');
  });

  it('copes with an empty transcript without calling the model', async () => {
    const provider = spyProvider();
    const out = await detectClips({ provider, transcript: { segments: [] }, analysis: {}, requestedClipCount: 3, userId: null, processingJobId: null });
    expect(out).toEqual({ candidates: [], source: 'none', proposalCount: 0 });
    expect(provider.generateStructuredOutput).not.toHaveBeenCalled();
  });
});

describe('persistClips', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('saves the hook, the ranking and the score breakdown (the breakdown used to be lost on the way to the database)', async () => {
    const [user] = await db('users').insert({ email: `cd-${Date.now()}@example.com`, password_hash: 'x' }).returning('*');
    const [ws] = await db('workspaces').insert({ name: 'w', owner_id: user.id }).returning('*');
    const [project] = await db('projects').insert({ workspace_id: ws.id, title: 'p', created_by: user.id }).returning('*');
    const [asset] = await db('media_assets')
      .insert({ project_id: project.id, uploaded_by: user.id, original_filename: 'a.mp4', storage_key: 'k', mime_type: 'video/mp4', size_bytes: 1, checksum_sha256: 'c', status: 'validated' })
      .returning('*');
    const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'FINDING_CLIPS' }).returning('*');

    const { candidates } = await detectClips({ provider: spyProvider(), transcript: TRANSCRIPT, analysis: { clips: [proposal(10, 20), proposal(200, 210)] }, requestedClipCount: 2, userId: null, processingJobId: null });
    await persistClips(job.id, candidates);

    const rows = await db('clip_candidates').where({ processing_job_id: job.id }).orderBy('rank');
    expect(rows).toHaveLength(2);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].hook).toMatch(/^Statement \d+ continues with/);
    expect(rows[0].score_breakdown).toEqual(expect.objectContaining({ hookPresence: expect.any(Number), durationFit: expect.any(Number) }));
    expect(Number(rows[0].final_score)).toBeGreaterThanOrEqual(Number(rows[1].final_score));
  });
});
