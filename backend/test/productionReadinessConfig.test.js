describe('GEMINI_MODEL and FFMPEG_TIMEOUT_MS configuration', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function loadConfigWith(overrides) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, ...overrides };
    // eslint-disable-next-line global-require
    return require('../src/config');
  }

  it('GEMINI_MODEL defaults to a real, non-retired model id — not the hardcoded gemini-1.5-flash this app used to ship with', () => {
    const config = loadConfigWith({});
    expect(config.ai.geminiModel).toBeTruthy();
    expect(config.ai.geminiModel).not.toBe('gemini-1.5-flash');
  });

  it('GEMINI_MODEL is configurable via env, so a future deprecation is a config change, not a code change', () => {
    const config = loadConfigWith({ GEMINI_MODEL: 'gemini-4.0-flash-hypothetical' });
    expect(config.ai.geminiModel).toBe('gemini-4.0-flash-hypothetical');
  });

  it('FFMPEG_TIMEOUT_MS defaults to 5 minutes when unset', () => {
    const config = loadConfigWith({});
    expect(config.ffmpeg.timeoutMs).toBe(5 * 60 * 1000);
  });

  it('FFMPEG_TIMEOUT_MS is configurable via env, for legitimately large/slow inputs on real production hardware', () => {
    const config = loadConfigWith({ FFMPEG_TIMEOUT_MS: '900000' });
    expect(config.ffmpeg.timeoutMs).toBe(900000);
  });
});
