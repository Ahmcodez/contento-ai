const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ssrfFetch = require('../src/security/ssrfSafeFetch');
const DirectMediaProvider = require('../src/providers/DirectMediaProvider');
const { resolveProvider } = require('../src/providers/ProviderResolver');
const { ProviderError } = require('../src/providers/URLProvider');

describe('DirectMediaProvider', () => {
  let server;
  let baseUrl;
  let isPublicSpy;
  const provider = new DirectMediaProvider();

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/video.mp4' && req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '123456' });
        res.end();
      } else if (req.url === '/video.mp4' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        res.end('fake mp4 bytes');
      } else if (req.url === '/notes.pdf' && req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '999' });
        res.end();
      } else if (req.url === '/missing.mp4') {
        res.writeHead(404);
        res.end();
      } else if (req.url === '/no-content-type.mp4' && req.method === 'HEAD') {
        res.writeHead(200, {});
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => { server.close(done); });

  beforeEach(() => {
    isPublicSpy = jest.spyOn(ssrfFetch, 'isPublicAddress').mockImplementation((addr) => addr === '127.0.0.1');
  });

  afterEach(() => {
    isPublicSpy.mockRestore();
  });

  describe('canHandle', () => {
    it('matches known video extensions', () => {
      expect(provider.canHandle('https://cdn.example.com/clip.mp4')).toBe(true);
      expect(provider.canHandle('https://cdn.example.com/clip.mov')).toBe(true);
      expect(provider.canHandle('https://cdn.example.com/clip.mkv?x=1')).toBe(true);
      expect(provider.canHandle('https://cdn.example.com/clip.webm')).toBe(true);
    });

    it('rejects non-video extensions and non-http(s) schemes', () => {
      expect(provider.canHandle('https://cdn.example.com/notes.pdf')).toBe(false);
      expect(provider.canHandle('https://youtube.com/watch?v=abc123')).toBe(false);
      expect(provider.canHandle('file:///etc/passwd')).toBe(false);
      expect(provider.canHandle('not a url at all')).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('returns size and a derived title for a reachable direct video URL', async () => {
      const meta = await provider.getMetadata(`${baseUrl}/video.mp4`);
      expect(meta.sizeBytes).toBe(123456);
      expect(meta.title).toBe('video.mp4');
      expect(meta.durationSeconds).toBeNull(); // not knowable without downloading
    });

    it('rejects a URL whose Content-Type is not a supported video format', async () => {
      await expect(provider.getMetadata(`${baseUrl}/notes.pdf`)).rejects.toMatchObject({
        name: 'ProviderError',
        reason: 'unsupported_media_type',
      });
    });

    it('rejects a 404', async () => {
      await expect(provider.getMetadata(`${baseUrl}/missing.mp4`)).rejects.toMatchObject({
        name: 'ProviderError',
        reason: 'unreachable',
      });
    });

    it('does not reject when Content-Type is simply absent (real check happens after download)', async () => {
      await expect(provider.getMetadata(`${baseUrl}/no-content-type.mp4`)).resolves.toBeDefined();
    });

    it('rejects a URL that fails SSRF validation (unmocked classifier)', async () => {
      isPublicSpy.mockRestore();
      await expect(provider.getMetadata('http://localhost/video.mp4')).rejects.toMatchObject({ name: 'ProviderError' });
    });
  });

  describe('download', () => {
    it('downloads the real body to destPath', async () => {
      const dest = path.join(os.tmpdir(), `direct-provider-test-${Date.now()}.mp4`);
      const result = await provider.download(`${baseUrl}/video.mp4`, dest, { maxBytes: 1024 });
      expect(fs.readFileSync(dest, 'utf8')).toBe('fake mp4 bytes');
      expect(result.sizeBytes).toBeGreaterThan(0);
      fs.rmSync(dest, { force: true });
    });

    it('rejects and cleans up when the file exceeds maxBytes', async () => {
      const dest = path.join(os.tmpdir(), `direct-provider-test-big-${Date.now()}.mp4`);
      await expect(provider.download(`${baseUrl}/video.mp4`, dest, { maxBytes: 2 })).rejects.toMatchObject({ name: 'ProviderError' });
      expect(fs.existsSync(dest)).toBe(false);
    });
  });
});

describe('ProviderResolver', () => {
  it('resolves a direct video URL to DirectMediaProvider', () => {
    const provider = resolveProvider('https://cdn.example.com/clip.mp4');
    expect(provider.name).toBe('direct');
  });

  it('throws a non-retryable ProviderError for an unsupported URL', () => {
    expect(() => resolveProvider('https://example.com/some/page')).toThrow(ProviderError);
    try {
      resolveProvider('https://example.com/some/page');
    } catch (err) {
      expect(err.retryable).toBe(false);
      expect(err.reason).toBe('unsupported_provider');
    }
  });
});
