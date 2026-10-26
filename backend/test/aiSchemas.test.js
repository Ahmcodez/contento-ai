const { clipProposalsSchema, CLIP_PROPOSALS_JSON_SCHEMA, contentAnalysisSchema, CONTENT_ANALYSIS_JSON_SCHEMA } = require('../src/ai/schemas');

describe('clipProposalsSchema: hook is required (real fix — hook used to be optional)', () => {
  const baseClip = { startLine: 0, endLine: 5, title: 'A clip' };

  it('rejects a clip response with no hook field at all', () => {
    const result = clipProposalsSchema.safeParse({ clips: [{ ...baseClip }] });
    expect(result.success).toBe(false);
  });

  it('rejects a clip with an empty-string hook', () => {
    const result = clipProposalsSchema.safeParse({ clips: [{ ...baseClip, hook: '' }] });
    expect(result.success).toBe(false);
  });

  it('rejects a trivially short hook (not a real claim)', () => {
    const result = clipProposalsSchema.safeParse({ clips: [{ ...baseClip, hook: 'Hi' }] });
    expect(result.success).toBe(false);
  });

  it('accepts a clip with a real hook', () => {
    const result = clipProposalsSchema.safeParse({
      clips: [{ ...baseClip, hook: 'Most people get this backwards and it costs them years.' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a hook over the 500-character ceiling', () => {
    const result = clipProposalsSchema.safeParse({ clips: [{ ...baseClip, hook: 'x'.repeat(501) }] });
    expect(result.success).toBe(false);
  });

  it('the JSON schema sent to Gemini also marks hook as required, matching the zod schema', () => {
    expect(CLIP_PROPOSALS_JSON_SCHEMA.properties.clips.items.required).toContain('hook');
    expect(CONTENT_ANALYSIS_JSON_SCHEMA.properties.clips.items.required).toEqual(expect.arrayContaining(['hook', 'startLine', 'endLine']));
  });

  it('an empty clips array is still valid (no clips found is a legitimate outcome)', () => {
    expect(clipProposalsSchema.safeParse({ clips: [] }).success).toBe(true);
    expect(clipProposalsSchema.safeParse({}).success).toBe(true); // clips defaults to []
  });
});

describe('clip proposals travel with the content analysis', () => {
  const analysis = { summary: 's', topics: [] };

  it('accepts an analysis with no proposals (a stretch with nothing clip-worthy is legitimate)', () => {
    expect(contentAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it('rejects an analysis whose proposal has no hook, so the whole chunk is retried rather than a hookless clip slipping through', () => {
    const result = contentAnalysisSchema.safeParse({ ...analysis, clips: [{ startLine: 1, endLine: 4, title: 'x' }] });
    expect(result.success).toBe(false);
  });

  it('rejects proposals whose line ids are not whole non-negative numbers', () => {
    for (const bad of [{ startLine: -1 }, { startLine: 1.5 }, { startLine: 'one' }]) {
      const clip = { startLine: 0, endLine: 3, hook: 'A real hook line here', title: 'x', ...bad };
      expect(contentAnalysisSchema.safeParse({ ...analysis, clips: [clip] }).success).toBe(false);
    }
  });
});
