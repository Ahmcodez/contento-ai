const { z } = require('zod');
const { callStructured, callText } = require('../src/ai/reliableCall');
const { AIProviderError } = require('../src/ai/AIProvider');

// A fake user id ensures usage tracking is exercised without touching a
// real users table (recordAiRequest is mocked below, not hitting the DB).
jest.mock('../src/services/usage.service', () => ({
  recordAiRequest: jest.fn().mockResolvedValue(undefined),
  countAiRequestsToday: jest.fn(),
}));

const usageService = require('../src/services/usage.service');

const simpleSchema = z.object({ value: z.number() });

function makeProvider(sequenceOfResults) {
  let call = 0;
  return {
    generateStructuredOutput: jest.fn(async () => {
      const result = sequenceOfResults[call];
      call += 1;
      if (result instanceof Error) throw result;
      return result;
    }),
    generateText: jest.fn(async () => {
      const result = sequenceOfResults[call];
      call += 1;
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('callStructured', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns validated data on first success', async () => {
    const provider = makeProvider([{ data: { value: 42 }, usage: { inputTokens: 1, outputTokens: 1 } }]);
    const { data } = await callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 3 });
    expect(data).toEqual({ value: 42 });
    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(1);
  });

  it('records ai usage on every real call', async () => {
    const provider = makeProvider([{ data: { value: 1 }, usage: {} }]);
    await callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, userId: 'u1', processingJobId: 'j1', maxAttempts: 3 });
    expect(usageService.recordAiRequest).toHaveBeenCalledWith({ userId: 'u1', processingJobId: 'j1' });
  });

  it('retries a retryable provider error and succeeds on the second attempt', async () => {
    const provider = makeProvider([
      new AIProviderError('rate limited', { retryable: true, reason: 'rate_limited' }),
      { data: { value: 7 }, usage: {} },
    ]);
    const { data } = await callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 3 });
    expect(data).toEqual({ value: 7 });
    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error (e.g. not configured)', async () => {
    const provider = makeProvider([new AIProviderError('no key', { retryable: false, reason: 'not_configured' })]);
    await expect(
      callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 3 }),
    ).rejects.toThrow('no key');
    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting maxAttempts on a persistently retryable error', async () => {
    const err = new AIProviderError('always fails', { retryable: true, reason: 'provider_error' });
    const provider = makeProvider([err, err, err]);
    await expect(
      callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 3 }),
    ).rejects.toThrow('always fails');
    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(3);
  });

  it('treats a schema-invalid (but parseable) response as retryable and retries', async () => {
    const provider = makeProvider([
      { data: { value: 'not-a-number' }, usage: {} }, // fails zod validation
      { data: { value: 99 }, usage: {} },
    ]);
    const { data } = await callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 3 });
    expect(data).toEqual({ value: 99 });
    expect(provider.generateStructuredOutput).toHaveBeenCalledTimes(2);
  });

  it('fails with a clear error if every attempt returns schema-invalid data', async () => {
    const provider = makeProvider([
      { data: { value: 'bad' }, usage: {} },
      { data: { value: 'still bad' }, usage: {} },
    ]);
    await expect(
      callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 2 }),
    ).rejects.toThrow('did not match the expected schema');
  });

  it('does not swallow unexpected (non-AIProviderError) exceptions — still retries them as transient', async () => {
    const provider = makeProvider([new Error('unexpected network blip'), { data: { value: 5 }, usage: {} }]);
    const { data } = await callStructured({ provider, prompt: 'p', zodSchema: simpleSchema, maxAttempts: 3 });
    expect(data).toEqual({ value: 5 });
  });
});

describe('callText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns text on success', async () => {
    const provider = makeProvider([{ text: 'hello', usage: {} }]);
    const { text } = await callText({ provider, prompt: 'p', maxAttempts: 3 });
    expect(text).toBe('hello');
  });

  it('retries retryable errors for text generation too', async () => {
    const provider = makeProvider([
      new AIProviderError('temporary', { retryable: true }),
      { text: 'recovered', usage: {} },
    ]);
    const { text } = await callText({ provider, prompt: 'p', maxAttempts: 3 });
    expect(text).toBe('recovered');
  });

  it('does not retry a non-retryable text generation error', async () => {
    const provider = makeProvider([new AIProviderError('bad request', { retryable: false })]);
    await expect(callText({ provider, prompt: 'p', maxAttempts: 3 })).rejects.toThrow('bad request');
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });
});
