const db = require('../src/db/client');
const config = require('../src/config');
const { analyzeTranscript, persistAnalysis, mergeAnalyses, buildPrompt, proposalQuota } = require('../src/services/contentAnalysis.service');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT } = require('../src/ai/promptSafety');

// Segment i spans [i*6000, i*6000+5800) and is long enough to be its own line.
const SEGMENT_TEXT = (i) => `Segment number ${i} has enough words in it to stand as a line of its own in this test.`;
const makeTranscript = (count, textFor = SEGMENT_TEXT) => ({
  segments: Array.from({ length: count }, (_, i) => ({ startMs: i * 6000, endMs: i * 6000 + 5800, text: textFor(i) })),
});

const baseData = (overrides = {}) => ({ summary: 'A summary.', topics: ['topic'], ...overrides });
const providerReturning = (fn) => ({
  generateStructuredOutput: jest.fn(async (args) => ({ data: typeof fn === 'function' ? fn(args) : fn, usage: {} })),
  generateText: jest.fn(),
});

describe('proposalQuota', () => {
  it('asks for more proposals than clips wanted, so selection has real choice', () => {
    const q = proposalQuota({ requestedClipCount: 5, chunkDurationMs: 600000, totalDurationMs: 600000 });
    expect(q).toBeGreaterThan(5);
  });

  it("splits the ask across chunks by each chunk's share of the video, never below one", () => {
    const total = 7200000;
    const quotas = [0.5, 0.3, 0.2].map((share) => proposalQuota({ requestedClipCount: 5, chunkDurationMs: total * share, totalDurationMs: total }));
    expect(quotas.every((q) => q >= 1)).toBe(true);
    expect(quotas[0]).toBeGreaterThan(quotas[2]);
    expect(quotas.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(8);
    expect(proposalQuota({ requestedClipCount: 1, chunkDurationMs: 1000, totalDurationMs: 1000000 })).toBe(1);
  });

  it('is capped so one call cannot be asked for an unreasonable number', () => {
    expect(proposalQuota({ requestedClipCount: 20, chunkDurationMs: 1, totalDurationMs: 1 })).toBeLessThanOrEqual(24);
  });
});

describe('analysis prompt', () => {
  it('shows line ids and time markers, asks for ids not times, and states the hook-to-explanation rule', () => {
    const p = buildPrompt('[0] hello\n-- 1:02 --\n[1] world', { quota: 4 });
    expect(p).toContain('[0] hello');
    expect(p).toContain('-- 1:02 --');
    expect(p).toMatch(/ONLY by these ids/);
    expect(p).toMatch(/up to 4 short-form clips/);
    expect(p).toMatch(/START at the line where the HOOK is first spoken/);
    expect(p).toMatch(/RUN THROUGH the line where that topic's explanation is complete/);
    expect(p).toContain(`${config.limits.clipMinDurationSeconds}-${config.limits.clipMaxDurationSeconds} seconds`);
    expect(p).toMatch(/<transcript>[\s\S]*<\/transcript>/);
  });
});

describe('analyzeTranscript', () => {
  it('sends line-numbered text with the untrusted-transcript guard, and a quota sized from the clip count', async () => {
    const provider = providerReturning(baseData());
    await analyzeTranscript({ provider, transcript: makeTranscript(30), requestedClipCount: 3, userId: null, processingJobId: null });

    const call = provider.generateStructuredOutput.mock.calls[0][0];
    expect(call.systemPrompt).toBe(UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT);
    expect(call.prompt).toContain('[0] Segment number 0');
    expect(call.prompt).toContain('[29] Segment number 29');
    expect(call.prompt).toMatch(/-- \d+:\d{2} --/); // 30 segments x 6s = 3 minutes, so markers appear
    expect(call.prompt).toMatch(/up to 5 short-form clips/); // ceil(3 x 1.6)
  });

  it('turns the line ids the model answers with into the real timestamps of those lines', async () => {
    const provider = providerReturning(
      baseData({
        stories: [{ text: 'a story', startLine: 4, endLine: 6 }],
        memorableQuotes: [{ text: 'a quote', startLine: 10 }],
        keyPoints: [{ text: 'no position given' }],
      }),
    );
    const result = await analyzeTranscript({ provider, transcript: makeTranscript(30), userId: null, processingJobId: null });

    expect(result.stories).toEqual([{ text: 'a story', startMs: 4 * 6000, endMs: 6 * 6000 + 5800 }]);
    expect(result.memorableQuotes[0]).toMatchObject({ startMs: 10 * 6000, endMs: 10 * 6000 + 5800 });
    expect(result.keyPoints).toEqual([{ text: 'no position given' }]); // no ids -> no invented times
    expect(JSON.stringify(result.stories)).not.toContain('Line');
  });

  it('keeps clip proposals as line spans, repairing reversed ids and dropping ones that point nowhere', async () => {
    const provider = providerReturning(
      baseData({
        clips: [
          { startLine: 5, endLine: 9, hook: 'The first thing they say', title: 'Good one', score: 88 },
          { startLine: 20, endLine: 14, hook: 'Reversed ids from the model', title: 'Reversed' },
          { startLine: 900, endLine: 905, hook: 'Points at nothing at all', title: 'Out of range' },
        ],
      }),
    );
    const result = await analyzeTranscript({ provider, transcript: makeTranscript(30), userId: null, processingJobId: null });

    expect(result.clips.map((c) => [c.title, c.startLine, c.endLine])).toEqual([
      ['Good one', 5, 9],
      ['Reversed', 14, 20],
    ]);
    expect(result.clips[0]).toMatchObject({ hook: 'The first thing they say', score: 88 });
  });

  it('rejects a proposal with no hook text, so a clip can never ship without one', async () => {
    const provider = providerReturning(baseData({ clips: [{ startLine: 1, endLine: 3, hook: '', title: 'No hook' }] }));
    await expect(
      analyzeTranscript({ provider, transcript: makeTranscript(10), userId: null, processingJobId: null }),
    ).rejects.toThrow();
  });

  it('on a long transcript uses several calls, keeps ids global across them, and resolves each chunk correctly', async () => {
    // ~110 chars per line x 700 lines = ~77k chars, i.e. three chunks at 30k.
    const transcript = makeTranscript(700, (i) => `${SEGMENT_TEXT(i)} Padding words so that each line carries a realistic amount of text.`);
    const seenFirstIds = [];
    const provider = providerReturning(({ prompt }) => {
      const ids = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      seenFirstIds.push(ids[0]);
      const pick = ids[Math.floor(ids.length / 2)];
      return baseData({ clips: [{ startLine: pick, endLine: pick + 2, hook: `Hook spoken at line ${pick}`, title: `Clip at ${pick}` }] });
    });

    const result = await analyzeTranscript({ provider, transcript, requestedClipCount: 5, userId: null, processingJobId: null });

    expect(provider.generateStructuredOutput.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(seenFirstIds[0]).toBe(0);
    expect(seenFirstIds[1]).toBeGreaterThan(100); // later chunks continue the numbering, they don't restart at 0
    expect(new Set(result.clips.map((c) => c.startLine)).size).toBe(result.clips.length);
    for (const clip of result.clips) expect(clip.title).toBe(`Clip at ${clip.startLine}`);
    // proposals from the later chunks point at the late part of the video
    expect(Math.max(...result.clips.map((c) => c.startLine))).toBeGreaterThan(400);
  });

  it('fails clearly on an empty transcript', async () => {
    await expect(analyzeTranscript({ provider: providerReturning(baseData()), transcript: { segments: [] }, userId: null, processingJobId: null })).rejects.toThrow(/no content/i);
  });
});

describe('mergeAnalyses', () => {
  it('concatenates clip proposals from every chunk', () => {
    const merged = mergeAnalyses([
      { summary: 'a', topics: ['x'], clips: [{ title: '1' }] },
      { summary: 'b', topics: ['X', 'y'], clips: [{ title: '2' }] },
    ]);
    expect(merged.clips.map((c) => c.title)).toEqual(['1', '2']);
    expect(merged.topics).toEqual(['x', 'y']);
  });
});

describe('persistAnalysis', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('stores the clip proposals alongside the analysis', async () => {
    const [user] = await db('users').insert({ email: `an-${Date.now()}@example.com`, password_hash: 'x' }).returning('*');
    const [ws] = await db('workspaces').insert({ name: 'w', owner_id: user.id }).returning('*');
    const [project] = await db('projects').insert({ workspace_id: ws.id, title: 'p', created_by: user.id }).returning('*');
    const [asset] = await db('media_assets')
      .insert({ project_id: project.id, uploaded_by: user.id, original_filename: 'a.mp4', storage_key: 'k', mime_type: 'video/mp4', size_bytes: 1, checksum_sha256: 'c', status: 'validated' })
      .returning('*');
    const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'ANALYZING' }).returning('*');

    const clips = [{ startLine: 3, endLine: 8, hook: 'A real hook line', title: 'T', score: 70 }];
    await persistAnalysis({ processingJobId: job.id, analysis: { summary: 's', topics: [], clips }, aiProvider: 'Mock' });

    const row = await db('content_analyses').where({ processing_job_id: job.id }).first();
    expect(row.clip_proposals).toEqual(clips);
  });
});
