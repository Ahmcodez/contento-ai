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

describe('GeminiProvider RetryInfo parsing (real incident: free-tier 5 req/min quota)', () => {
  let provider;
  let originalFetch;

  // The exact shape Gemini returns for RESOURCE_EXHAUSTED, reproduced
  // from a real worker log.
  const quotaExceededBody = JSON.stringify({
    error: {
      code: 429,
      message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 5',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generate_content_free_tier_requests', quotaValue: '5' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '44s' },
      ],
    },
  });

  beforeEach(() => {
    provider = new GeminiProvider('fake-key-for-tests');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extracts retryAfterMs from a real RESOURCE_EXHAUSTED response body', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => quotaExceededBody });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({
      retryable: true,
      reason: 'rate_limited',
      retryAfterMs: 44000,
    });
  });

  it('handles fractional seconds', async () => {
    const body = quotaExceededBody.replace('"44s"', '"1.5s"');
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => body });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryAfterMs: 1500 });
  });

  it('leaves retryAfterMs null when the body has no RetryInfo (e.g. a plain 500)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryAfterMs: null });
  });

  it('never throws on a malformed or non-JSON error body', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'not json at all {{{' });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryable: true, retryAfterMs: null });
  });
});

describe('GeminiProvider daily-quota detection (real incident: 20 req/day free tier)', () => {
  let provider;
  let originalFetch;

  // The exact shape from a real worker log: a PerDay quotaId, with
  // Gemini still (confusingly) including a short RetryInfo delay that
  // cannot actually fix a daily cap.
  const dailyQuotaBody = JSON.stringify({
    error: {
      code: 429,
      message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaValue: '20',
            },
          ],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '58s' },
      ],
    },
  });

  // The per-minute shape, kept passing here to prove the daily-quota
  // detection didn't regress the earlier per-minute fix.
  const perMinuteQuotaBody = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '44s' },
      ],
    },
  });

  beforeEach(() => {
    provider = new GeminiProvider('fake-key-for-tests');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('classifies a PerDay quota violation as non-retryable with an honest, actionable message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => dailyQuotaBody });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({
      retryable: false,
      reason: 'daily_quota_exceeded',
      message: expect.stringContaining('daily request limit'),
    });
  });

  it('does NOT set retryAfterMs for a daily quota — a short delay cannot fix a daily cap', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => dailyQuotaBody });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ retryAfterMs: null });
  });

  it('a PerMinute quota violation is unaffected: still retryable with its retryAfterMs honored', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => perMinuteQuotaBody });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({
      retryable: true,
      reason: 'rate_limited',
      retryAfterMs: 44000,
    });
  });
});

describe('GeminiProvider falls back to GEMINI_FALLBACK_MODEL on a daily-quota failure', () => {
  let originalFallbackModel;
  let originalFetch;

  const dailyQuotaBody = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }],
        },
      ],
    },
  });

  beforeEach(() => {
    originalFallbackModel = config.ai.geminiFallbackModel;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    config.ai.geminiFallbackModel = originalFallbackModel;
    global.fetch = originalFetch;
  });

  function modelFromUrl(url) {
    return url.match(/models\/([^:]+):/)[1];
  }

  it('retries the same request against the fallback model and returns its successful result', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    const calledModels = [];
    global.fetch = jest.fn().mockImplementation(async (url) => {
      calledModels.push(modelFromUrl(url));
      if (modelFromUrl(url) === 'gemini-3.6-flash') {
        return { ok: false, status: 429, text: async () => dailyQuotaBody };
      }
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'fallback worked' }] } }], usageMetadata: {} }) };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    const result = await provider.generateText({ prompt: 'p' });

    expect(result.text).toBe('fallback worked');
    expect(calledModels).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash-lite']);
  });

  it('is bounded to exactly one fallback hop: if the fallback model ALSO hits a daily quota, it fails (not an infinite retry loop)', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return { ok: false, status: 429, text: async () => dailyQuotaBody };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({
      retryable: false,
      reason: 'daily_quota_exceeded',
    });
    expect(callCount).toBe(2); // primary + exactly one fallback attempt, never more
  });

  it('is disabled when GEMINI_FALLBACK_MODEL is empty: fails on the primary model alone', async () => {
    config.ai.geminiFallbackModel = null;
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return { ok: false, status: 429, text: async () => dailyQuotaBody };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ reason: 'daily_quota_exceeded' });
    expect(callCount).toBe(1);
  });

  it('does not fall back for a malformed 503 body (can\'t confirm model-overload status, so no fallback) or for a plain network error', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return { ok: false, status: 503, text: async () => 'server error' }; // not valid JSON
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ reason: 'provider_error' });
    expect(callCount).toBe(1); // see the separate describe block below for the real UNAVAILABLE-body 503 case
  });

  it('never falls back to itself when GEMINI_FALLBACK_MODEL equals the primary model', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.6-flash'; // same as the provider's model below
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return { ok: false, status: 429, text: async () => dailyQuotaBody };
    });

    const provider = new GeminiProvider('fake-key-for-tests', { model: 'gemini-3.6-flash' });
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ reason: 'daily_quota_exceeded' });
    expect(callCount).toBe(1);
  });

  it('also applies to generateStructuredOutput, not just generateText', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (modelFromUrl(url) === 'gemini-3.6-flash') {
        return { ok: false, status: 429, text: async () => dailyQuotaBody };
      }
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: {} }),
      };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    const { data } = await provider.generateStructuredOutput({ prompt: 'p', schema: { type: 'object' } });
    expect(data).toEqual({ ok: true });
  });
});

describe('GeminiProvider falls back to GEMINI_FALLBACK_MODEL on a model-overload 503 (real incident)', () => {
  let originalFallbackModel;
  let originalFetch;

  // Exact shape from a real worker log: 503 UNAVAILABLE, "experiencing
  // high demand" — Google's own capacity problem, not this project's
  // quota, and distinct from the daily-quota 429 case above.
  const overloadedBody = JSON.stringify({
    error: {
      code: 503,
      message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
      status: 'UNAVAILABLE',
    },
  });

  beforeEach(() => {
    originalFallbackModel = config.ai.geminiFallbackModel;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    config.ai.geminiFallbackModel = originalFallbackModel;
    global.fetch = originalFetch;
  });

  function modelFromUrl(url) {
    return url.match(/models\/([^:]+):/)[1];
  }

  it('retries against the fallback model instead of only backing off and hammering the same overloaded model', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    const calledModels = [];
    global.fetch = jest.fn().mockImplementation(async (url) => {
      calledModels.push(modelFromUrl(url));
      if (modelFromUrl(url) === 'gemini-3.6-flash') {
        return { ok: false, status: 503, text: async () => overloadedBody };
      }
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'fallback succeeded' }] } }], usageMetadata: {} }) };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    const result = await provider.generateText({ prompt: 'p' });

    expect(result.text).toBe('fallback succeeded');
    expect(calledModels).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash-lite']);
  });

  it('is bounded to exactly one fallback hop and stays retryable when BOTH models are overloaded (unlike daily quota, a 503 can genuinely be transient)', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return { ok: false, status: 503, text: async () => overloadedBody };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({
      retryable: true,
      reason: 'provider_error',
    });
    expect(callCount).toBe(2);
  });

  it('does not treat an ordinary 500 as "overloaded" — no fallback, since the status must specifically be UNAVAILABLE', async () => {
    config.ai.geminiFallbackModel = 'gemini-3.5-flash-lite';
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      return { ok: false, status: 500, text: async () => JSON.stringify({ error: { code: 500, status: 'INTERNAL' } }) };
    });

    const provider = new GeminiProvider('fake-key-for-tests');
    await expect(provider.generateText({ prompt: 'p' })).rejects.toMatchObject({ reason: 'provider_error' });
    expect(callCount).toBe(1);
  });
});
