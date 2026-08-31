const GeminiProvider = require('../src/ai/GeminiProvider');
const { AIProviderError } = require('../src/ai/AIProvider');
const config = require('../src/config');

describe('GeminiProvider model selection', () => {
  let originalFetch;
  let capturedUrl;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('defaults to the configured GEMINI_MODEL, not a hardcoded string, so a model deprecation is a config change', async () => {
    const provider = new GeminiProvider('fake-key');
    await provider.generateText({ prompt: 'hello' });
    expect(capturedUrl).toContain(`/models/${config.ai.geminiModel}:generateContent`);
  });

  it('never hardcodes a specific retired model id (regression guard: gemini-1.5-flash is fully shut down as of this app\'s last verified check)', async () => {
    const provider = new GeminiProvider('fake-key');
    expect(provider.model).not.toBe('gemini-1.5-flash');
  });

  it('still allows an explicit model override for callers that need one', async () => {
    const provider = new GeminiProvider('fake-key', { model: 'gemini-3.5-flash-lite' });
    await provider.generateText({ prompt: 'hello' });
    expect(capturedUrl).toContain('/models/gemini-3.5-flash-lite:generateContent');
  });
});

describe('GeminiProvider structured output parsing', () => {
  let provider;
  let originalFetch;

  beforeEach(() => {
    provider = new GeminiProvider('fake-key-for-tests');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockGeminiResponse(text) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    });
  }

  it('parses clean JSON directly', async () => {
    mockGeminiResponse('{"value": 42}');
    const { data } = await provider.generateStructuredOutput({ prompt: 'p', schema: {} });
    expect(data).toEqual({ value: 42 });
  });

  it('recovers JSON wrapped in a markdown code fence', async () => {
    mockGeminiResponse('```json\n{"value": 42}\n```');
    const { data } = await provider.generateStructuredOutput({ prompt: 'p', schema: {} });
    expect(data).toEqual({ value: 42 });
  });

  it('recovers JSON wrapped in a plain code fence (no language tag)', async () => {
    mockGeminiResponse('```\n{"value": 7}\n```');
    const { data } = await provider.generateStructuredOutput({ prompt: 'p', schema: {} });
    expect(data).toEqual({ value: 7 });
  });

  it('throws a retryable AIProviderError for genuinely unparseable output', async () => {
    mockGeminiResponse('this is not json at all, sorry');
    await expect(provider.generateStructuredOutput({ prompt: 'p', schema: {} })).rejects.toThrow(AIProviderError);
    try {
      await provider.generateStructuredOutput({ prompt: 'p', schema: {} });
    } catch (err) {
      expect(err.retryable).toBe(true);
      expect(err.reason).toBe('invalid_structured_output');
    }
  });

  it('classifies a 429 response as retryable', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryable: true, reason: 'rate_limited' });
  });

  it('classifies a 500 response as retryable', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryable: true });
  });

  it('classifies a 400 response as non-retryable', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryable: false });
  });

  it('classifies a network failure as retryable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryable: true, reason: 'network_error' });
  });
});
