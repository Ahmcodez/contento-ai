const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../src/config');
const GroqTranscriptionProvider = require('../src/transcription/GroqTranscriptionProvider');

/** Starts a local server standing in for Groq's endpoint; handler decides the response. */
function startFakeGroq(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, Buffer.concat(chunks), res));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function verboseJson(body) {
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('GroqTranscriptionProvider', () => {
  let server;
  let baseUrl;
  let smallAudioPath;
  const originalApiKey = config.transcription.groqApiKey;
  const originalMaxUpload = config.transcription.groqMaxUploadBytes;
  const originalTimeout = config.transcription.groqTimeoutMs;
  const realFetch = global.fetch;

  beforeAll(() => {
    smallAudioPath = path.join(os.tmpdir(), `groq-test-${Date.now()}.wav`);
    fs.writeFileSync(smallAudioPath, Buffer.alloc(1024, 1)); // well under any upload limit
  });

  afterAll(() => {
    fs.rmSync(smallAudioPath, { force: true });
  });

  afterEach(async () => {
    global.fetch = realFetch;
    config.transcription.groqApiKey = originalApiKey;
    config.transcription.groqMaxUploadBytes = originalMaxUpload;
    config.transcription.groqTimeoutMs = originalTimeout;
    if (server) await new Promise((r) => server.close(r));
    server = undefined;
  });

  /** Points fetch at the fake server while preserving the real request (method/headers/body/signal). */
  function routeFetchToFakeServer() {
    global.fetch = (url, opts) => realFetch(baseUrl, opts);
  }

  async function serve(respond) {
    server = await startFakeGroq((req, body, res) => {
      const { statusCode, headers, body: responseBody } = respond(req, body);
      res.writeHead(statusCode, headers);
      res.end(responseBody);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/`;
    routeFetchToFakeServer();
  }

  it('sends a real multipart request with the file, model, and Bearer auth header', async () => {
    config.transcription.groqApiKey = 'test-key';
    let seenAuth;
    let seenBody;
    let seenContentType;
    await serve((req, body) => {
      seenAuth = req.headers.authorization;
      seenContentType = req.headers['content-type'];
      seenBody = body.toString('latin1');
      return verboseJson({ text: 'hello world', language: 'en', segments: [{ start: 0, end: 1.5, text: ' hello world' }] });
    });

    const provider = new GroqTranscriptionProvider();
    const result = await provider.transcribe(smallAudioPath);

    expect(seenAuth).toBe('Bearer test-key');
    expect(seenContentType).toContain('multipart/form-data');
    expect(seenBody).toContain('whisper-large-v3-turbo');
    expect(seenBody).toContain('name="file"');
    expect(result).toEqual({
      fullText: 'hello world',
      language: 'en',
      segments: [{ sequence: 0, startMs: 0, endMs: 1500, text: 'hello world' }],
      raw: expect.any(Object),
    });
  });

  it('derives fullText from segments when the API omits the top-level text field', async () => {
    config.transcription.groqApiKey = 'test-key';
    await serve(() => verboseJson({ segments: [{ start: 0, end: 1, text: ' one' }, { start: 1, end: 2, text: ' two' }] }));
    const result = await new GroqTranscriptionProvider().transcribe(smallAudioPath);
    expect(result.fullText).toBe('one two');
  });

  it('throws non-retryable when GROQ_API_KEY is not set, without making a request', async () => {
    config.transcription.groqApiKey = '';
    const provider = new GroqTranscriptionProvider({ apiKey: '' });
    await expect(provider.transcribe(smallAudioPath)).rejects.toMatchObject({
      name: 'TranscriptionProviderError',
      retryable: false,
      reason: 'not_configured',
    });
  });

  it.each([
    [401, 'authentication_failed', false],
    [403, 'authentication_failed', false],
    [429, 'rate_limited', true],
    [500, 'provider_error', true],
    [503, 'provider_error', true],
    [400, 'provider_error', false],
  ])('classifies HTTP %i as reason=%s, retryable=%s', async (status, reason, retryable) => {
    config.transcription.groqApiKey = 'test-key';
    await serve(() => ({ statusCode: status, headers: { 'content-type': 'application/json' }, body: '{"error":"nope"}' }));
    await expect(new GroqTranscriptionProvider().transcribe(smallAudioPath)).rejects.toMatchObject({
      name: 'TranscriptionProviderError',
      reason,
      retryable,
    });
  });

  it('gives a specific, actionable, non-retryable error for 413 even after compression was attempted', async () => {
    config.transcription.groqApiKey = 'test-key';
    await serve(() => ({ statusCode: 413, headers: {}, body: 'too big' }));
    await expect(new GroqTranscriptionProvider().transcribe(smallAudioPath)).rejects.toMatchObject({
      reason: 'file_too_large',
      retryable: false,
    });
  });

  it('times out and throws retryable when Groq never responds', async () => {
    config.transcription.groqApiKey = 'test-key';
    config.transcription.groqTimeoutMs = 100;
    server = await startFakeGroq(() => {}); // never responds
    baseUrl = `http://127.0.0.1:${server.address().port}/`;
    routeFetchToFakeServer();
    await expect(new GroqTranscriptionProvider().transcribe(smallAudioPath)).rejects.toMatchObject({
      reason: 'timeout',
      retryable: true,
    });
  }, 10000);

  it('throws retryable network_error when the endpoint is unreachable', async () => {
    config.transcription.groqApiKey = 'test-key';
    global.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(new GroqTranscriptionProvider().transcribe(smallAudioPath)).rejects.toMatchObject({
      reason: 'network_error',
      retryable: true,
    });
  });

  describe('large-file compression (scalability against MAX_VIDEO_DURATION_SECONDS)', () => {
    let bigAudioPath;

    beforeEach(() => {
      bigAudioPath = path.join(os.tmpdir(), `groq-big-test-${Date.now()}.wav`);
    });

    afterEach(() => {
      fs.rmSync(bigAudioPath, { force: true });
    });

    it('uploads the original file unmodified when under the size limit', async () => {
      config.transcription.groqApiKey = 'test-key';
      config.transcription.groqMaxUploadBytes = 10 * 1024 * 1024;
      fs.writeFileSync(bigAudioPath, Buffer.alloc(1024));
      let seenBody;
      await serve((req, body) => {
        seenBody = body;
        return verboseJson({ text: 'ok', segments: [] });
      });
      await new GroqTranscriptionProvider().transcribe(bigAudioPath);
      expect(seenBody.toString('latin1')).toContain(path.basename(bigAudioPath));
    });

    it('compresses via MediaProcessor before uploading when over the size limit, and cleans up the temp file', async () => {
      config.transcription.groqApiKey = 'test-key';
      config.transcription.groqMaxUploadBytes = 100; // force the "too big" path with a tiny fake file
      // A real, valid WAV header + silence so ffmpeg can actually transcode it.
      require('child_process').execFileSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-ar', '16000', '-ac', '1', bigAudioPath],
      );
      const beforeSize = fs.statSync(bigAudioPath).size;
      expect(beforeSize).toBeGreaterThan(config.transcription.groqMaxUploadBytes);

      let seenBody;
      let uploadedFilename;
      await serve((req, body) => {
        seenBody = body;
        const match = body.toString('latin1').match(/filename="([^"]+)"/);
        uploadedFilename = match && match[1];
        return verboseJson({ text: 'compressed ok', segments: [] });
      });

      const result = await new GroqTranscriptionProvider().transcribe(bigAudioPath);

      expect(result.fullText).toBe('compressed ok');
      expect(uploadedFilename).toMatch(/\.opus$/); // proves compression actually ran, not the raw WAV
      expect(seenBody.length).toBeLessThan(beforeSize); // the compressed upload is smaller than the source
      // temp file was cleaned up (not left behind under a fixed, discoverable name)
      const tmpLeftovers = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('groq-upload-'));
      expect(tmpLeftovers).toEqual([]);
    }, 15000);
  });
});
