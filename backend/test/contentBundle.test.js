const db = require('../src/db/client');
const { PHYSICAL_QUEUES, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');
const transcriptRepository = require('../src/repositories/transcript.repository');
const contentAnalysisRepository = require('../src/repositories/contentAnalysis.repository');
const { AIProviderError } = require('../src/ai/AIProvider');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT } = require('../src/ai/promptSafety');
const { generateAllContent, generateContent, buildBundlePrompt, CONTENT_TYPES } = require('../src/services/contentGeneration.service');
const { answerContentBundle } = require('./helpers/mockProviders');

jest.mock('../src/ai', () => ({ getAIProvider: () => global.__bundleProvider }));
const processContentGenerate = require('../src/workers/processors/contentGenerate.processor');

const MARKER = 'UNIQUE-TRANSCRIPT-MARKER';
const transcript = { fullText: `${MARKER} ${'The speaker explains something in some detail. '.repeat(1000)}` };
const analysis = { summary: 'A summary.', topics: ['a', 'b'] };

const bundleProvider = (data = answerContentBundle()) => ({
  constructor: { name: 'MockAIProvider' },
  generateStructuredOutput: jest.fn(async () => ({ data, usage: {} })),
  generateText: jest.fn(async () => ({ text: 'A per-type fallback piece of content that is long enough to be real content.', usage: {} })),
});

describe('generateAllContent', () => {
  it('makes one call that carries the transcript once, with every content type asked for', async () => {
    const provider = bundleProvider();
    const out = await generateAllContent({ provider, transcript, analysis, userId: null, processingJobId: null });

    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(provider.generateText).not.toHaveBeenCalled();
    const call = provider.generateStructuredOutput.mock.calls[0][0];
    expect(call.systemPrompt).toBe(UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT);
    expect(call.prompt.split(MARKER)).toHaveLength(2); // exactly one occurrence
    expect(call.prompt).toMatch(/<transcript>[\s\S]*<\/transcript>/);
    expect(call.prompt).toMatch(/GROUNDING RULES/);
    for (const type of CONTENT_TYPES) expect(call.prompt).toContain(`"${type}":`);
    expect(Object.keys(out)).toEqual(CONTENT_TYPES);
  });

  it('sends roughly one transcript worth of text where five separate calls sent five', async () => {
    const bundle = buildBundlePrompt(transcript, analysis).length;
    const provider = bundleProvider();
    for (const type of CONTENT_TYPES) {
       
      await generateContent({ provider, contentType: type, transcript, analysis, userId: null, processingJobId: null });
    }
    const separate = provider.generateText.mock.calls.reduce((sum, [args]) => sum + args.prompt.length, 0);

    expect(bundle).toBeLessThan(transcript.fullText.length * 1.1);
    expect(separate).toBeGreaterThan(transcript.fullText.length * 4.5);
    expect(separate / bundle).toBeGreaterThan(4);
  });

  it('enforces the X length limit in code and says so', async () => {
    const provider = bundleProvider({ ...answerContentBundle(), x_twitter: 'x'.repeat(400) });
    const out = await generateAllContent({ provider, transcript, analysis, userId: null, processingJobId: null });
    expect(out.x_twitter.body.length).toBeLessThanOrEqual(280);
    expect(out.x_twitter.metadata).toMatchObject({ truncated: true, characterCount: out.x_twitter.body.length });
    expect(out.blog.metadata.truncated).toBe(false);
  });

  it('rejects a response that is missing a piece, so it is retried rather than saved incomplete', async () => {
    const incomplete = { ...answerContentBundle(), linkedin: undefined };
    await expect(generateAllContent({ provider: bundleProvider(incomplete), transcript, analysis, userId: null, processingJobId: null })).rejects.toThrow();
  });
});

describe('content.generate stage', () => {
  async function seedJob() {
    const [user] = await db('users').insert({ email: `cb-${Date.now()}-${Math.random()}@example.com`, password_hash: 'x' }).returning('*');
    const [ws] = await db('workspaces').insert({ name: 'w', owner_id: user.id }).returning('*');
    const [project] = await db('projects').insert({ workspace_id: ws.id, title: 'p', created_by: user.id }).returning('*');
    const [asset] = await db('media_assets')
      .insert({ project_id: project.id, uploaded_by: user.id, original_filename: 'a.mp4', storage_key: 'k', mime_type: 'video/mp4', size_bytes: 1, checksum_sha256: `c${Math.random()}`, status: 'validated' })
      .returning('*');
    const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'CLIPS_RENDERED' }).returning('*');
    await transcriptRepository.create({ mediaAssetId: asset.id, fullText: transcript.fullText, language: 'en', provider: 'groq', segments: [{ startMs: 0, endMs: 5000, text: 'hello there' }] });
    await contentAnalysisRepository.create({ processingJobId: job.id, analysis: { summary: 's', topics: [] }, aiProvider: 'Mock' });
    return { job, asset };
  }
  const run = ({ job, asset }) => processContentGenerate({ data: { processingJobId: job.id, mediaAssetId: asset.id } });
  const rows = (job) => db('generated_content').where({ processing_job_id: job.id }).orderBy('content_type');

  beforeEach(async () => {
    await resetDb();
    await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).obliterate({ force: true });
  });
  afterAll(async () => {
    await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).obliterate({ force: true });
    await closeAllQueues();
  });

  it('saves all five pieces from the single call and never makes the per-type calls', async () => {
    global.__bundleProvider = bundleProvider();
    const seeded = await seedJob();
    await run(seeded);

    expect(global.__bundleProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(global.__bundleProvider.generateText).not.toHaveBeenCalled();
    expect((await rows(seeded.job)).map((r) => r.content_type)).toEqual([...CONTENT_TYPES].sort());
    expect((await db('processing_jobs').where({ id: seeded.job.id }).first()).state).toBe('CONTENT_GENERATED');
  });

  it('falls back to one call per type when the combined answer cannot be validated, so the user still gets their content', async () => {
    global.__bundleProvider = bundleProvider({ blog: 'only this one' }); // never validates
    const seeded = await seedJob();
    await run(seeded);

    expect(global.__bundleProvider.generateText).toHaveBeenCalledTimes(5);
    expect(await rows(seeded.job)).toHaveLength(5);
    expect((await db('processing_jobs').where({ id: seeded.job.id }).first()).state).toBe('CONTENT_GENERATED');
  }, 60000);

  it('fails the job cleanly, with no wasted per-type calls, when the provider is not usable', async () => {
    global.__bundleProvider = bundleProvider();
    global.__bundleProvider.generateStructuredOutput.mockRejectedValue(new AIProviderError('No AI key configured', { retryable: false, reason: 'not_configured' }));
    const seeded = await seedJob();
    await run(seeded);

    expect(global.__bundleProvider.generateText).not.toHaveBeenCalled();
    const job = await db('processing_jobs').where({ id: seeded.job.id }).first();
    expect(job.state).toBe('FAILED');
    expect(job.error_message).toMatch(/No AI key/);
    expect(await rows(seeded.job)).toHaveLength(0);
  });
});
