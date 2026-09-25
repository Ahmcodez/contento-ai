describe('transcription provider factory', () => {
  afterEach(() => {
    jest.resetModules();
  });

  // jest.resetModules() clears the whole require cache, including
  // src/config's own module instance — so config must be required FRESH
  // inside the same reset cycle as transcription/index.js, and mutated
  // before that require, or the mutation targets a config instance the
  // factory never sees.
  function freshFactoryWithProvider(providerName) {
    jest.resetModules();
    const config = require('../src/config');
    config.transcription.provider = providerName;
    return require('../src/transcription');
  }

  it('returns a WhisperLocalProvider instance when TRANSCRIPTION_PROVIDER=whisper-local', () => {
    const { getTranscriptionProvider } = freshFactoryWithProvider('whisper-local');
    const WhisperLocalProvider = require('../src/transcription/WhisperLocalProvider');
    expect(getTranscriptionProvider()).toBeInstanceOf(WhisperLocalProvider);
  });

  it('returns a GroqTranscriptionProvider instance when TRANSCRIPTION_PROVIDER=groq', () => {
    const { getTranscriptionProvider } = freshFactoryWithProvider('groq');
    const GroqTranscriptionProvider = require('../src/transcription/GroqTranscriptionProvider');
    expect(getTranscriptionProvider()).toBeInstanceOf(GroqTranscriptionProvider);
  });

  it('memoizes: the same instance is returned across calls', () => {
    const { getTranscriptionProvider } = freshFactoryWithProvider('groq');
    expect(getTranscriptionProvider()).toBe(getTranscriptionProvider());
  });

  it('throws a clean, non-retryable, actionable error for both providers when TRANSCRIPTION_PROVIDER=none', async () => {
    const { getTranscriptionProvider } = freshFactoryWithProvider('none');
    await expect(getTranscriptionProvider().transcribe('/tmp/x.wav')).rejects.toMatchObject({
      name: 'TranscriptionProviderError',
      retryable: false,
      reason: 'not_configured',
      message: expect.stringContaining('TRANSCRIPTION_PROVIDER=groq'),
    });
  });
});
