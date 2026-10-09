const { clipCandidatesSchema, CLIP_CANDIDATES_JSON_SCHEMA } = require('../src/ai/schemas');

describe('clipCandidatesSchema: hook is required (real fix — hook used to be optional)', () => {
  const baseClip = { startMs: 0, endMs: 30000, title: 'A clip' };

  it('rejects a clip response with no hook field at all', () => {
    const result = clipCandidatesSchema.safeParse({ clips: [{ ...baseClip }] });
    expect(result.success).toBe(false);
  });

  it('rejects a clip with an empty-string hook', () => {
    const result = clipCandidatesSchema.safeParse({ clips: [{ ...baseClip, hook: '' }] });
    expect(result.success).toBe(false);
  });

  it('rejects a trivially short hook (not a real claim)', () => {
    const result = clipCandidatesSchema.safeParse({ clips: [{ ...baseClip, hook: 'Hi' }] });
    expect(result.success).toBe(false);
  });

  it('accepts a clip with a real hook', () => {
    const result = clipCandidatesSchema.safeParse({
      clips: [{ ...baseClip, hook: 'Most people get this backwards and it costs them years.' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a hook over the 500-character ceiling', () => {
    const result = clipCandidatesSchema.safeParse({ clips: [{ ...baseClip, hook: 'x'.repeat(501) }] });
    expect(result.success).toBe(false);
  });

  it('the JSON schema sent to Gemini also marks hook as required, matching the zod schema', () => {
    expect(CLIP_CANDIDATES_JSON_SCHEMA.properties.clips.items.required).toContain('hook');
  });

  it('an empty clips array is still valid (no clips found is a legitimate outcome)', () => {
    expect(clipCandidatesSchema.safeParse({ clips: [] }).success).toBe(true);
    expect(clipCandidatesSchema.safeParse({}).success).toBe(true); // clips defaults to []
  });
});
