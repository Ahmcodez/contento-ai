const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ssrfFetch = require('../src/security/ssrfSafeFetch');
const { SsrfBlockedError } = ssrfFetch;

/**
 * These tests exercise the real request/redirect/streaming machinery
 * against a real local HTTP server, rather than mocking the network
 * layer — the one thing that has to be faked is the *policy decision*
 * of what counts as "public" (isPublicAddress), since the test server
 * necessarily lives on loopback. Scoping the mock to return true only
 * for the exact loopback address the test server is bound to (127.0.0.1)
 * — not true unconditionally — means a redirect to any other address in
 * these tests still goes through the real (mocked-false) rejection path,
 * which is what the "revalidates every redirect hop" tests below depend
 * on.
 */
describe('ssrfSafeFetch (integration, real local server)', () => {
  let server;
  let baseUrl;
  let isPublicSpy;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('hello');
      } else if (req.url === '/redirect-once') {
        res.writeHead(302, { Location: '/ok' });
        res.end();
      } else if (req.url === '/redirect-loop') {
        res.writeHead(302, { Location: '/redirect-loop' });
        res.end();
      } else if (req.url === '/redirect-to-blocked') {
        // Simulates a malicious server 302ing a validated URL to a
        // target that must independently fail validation.
        res.writeHead(302, { Location: 'http://192.0.2.1/internal' });
        res.end();
      } else if (req.url === '/big-file') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        // 2MB, streamed in chunks — no Content-Length header, so the
        // streaming byte-counter (not the upfront Content-Length check)
        // is what has to catch this.
        const chunk = Buffer.alloc(64 * 1024, 'x');
        let sent = 0;
        const interval = setInterval(() => {
          if (sent >= 2 * 1024 * 1024 || res.destroyed) {
            clearInterval(interval);
            if (!res.destroyed) res.end();
            return;
          }
          res.write(chunk);
          sent += chunk.length;
        }, 1);
      } else if (req.url === '/declared-too-large') {
        res.writeHead(200, { 'Content-Length': '99999999' });
        res.end('short body, but Content-Length lied');
      } else if (req.url === '/slow') {
        // never responds — for timeout testing
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

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    isPublicSpy = jest.spyOn(ssrfFetch, 'isPublicAddress').mockImplementation((addr) => addr === '127.0.0.1');
  });

  afterEach(() => {
    isPublicSpy.mockRestore();
  });

  describe('scheme + DNS validation', () => {
    it('rejects non-http(s) schemes before any network access', async () => {
      await expect(ssrfFetch.validateUrl('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError);
      await expect(ssrfFetch.validateUrl('ftp://example.com/file')).rejects.toThrow(SsrfBlockedError);
      await expect(ssrfFetch.validateUrl('gopher://example.com/')).rejects.toThrow(SsrfBlockedError);
      await expect(ssrfFetch.validateUrl('data:text/plain,hello')).rejects.toThrow(SsrfBlockedError);
    });

    it('rejects a hostname that resolves to a blocked address (real classifier, unmocked)', async () => {
      isPublicSpy.mockRestore(); // use the real classifier for this one
      await expect(ssrfFetch.validateUrl('http://localhost/')).rejects.toThrow(SsrfBlockedError);
    });

    it('accepts a URL whose resolved address passes the (mocked, scoped) classifier', async () => {
      await expect(ssrfFetch.validateUrl(`${baseUrl}/ok`)).resolves.toBeDefined();
    });
  });

  describe('successful fetch', () => {
    it('fetchHeaders returns status + headers without downloading a body', async () => {
      const result = await ssrfFetch.fetchHeaders(`${baseUrl}/ok`);
      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toBe('text/plain');
    });

    it('downloadToFile writes the real response body to disk', async () => {
      const dest = path.join(os.tmpdir(), `ssrf-test-${Date.now()}.txt`);
      const result = await ssrfFetch.downloadToFile(`${baseUrl}/ok`, dest, { maxBytes: 1024 });
      expect(fs.readFileSync(dest, 'utf8')).toBe('hello');
      expect(result.bytesWritten).toBe(5);
      fs.rmSync(dest, { force: true });
    });
  });

  describe('redirect handling', () => {
    it('follows a single redirect to completion', async () => {
      const result = await ssrfFetch.fetchHeaders(`${baseUrl}/redirect-once`);
      expect(result.statusCode).toBe(200);
      expect(result.finalUrl).toBe(`${baseUrl}/ok`);
    });

    it('rejects a redirect loop once maxRedirects is exceeded', async () => {
      await expect(ssrfFetch.fetchHeaders(`${baseUrl}/redirect-loop`, { maxRedirects: 3 })).rejects.toThrow(/redirects/i);
    });

    it('re-validates the redirect target and blocks it if disallowed (closes the redirect-to-internal SSRF bypass)', async () => {
      await expect(ssrfFetch.fetchHeaders(`${baseUrl}/redirect-to-blocked`)).rejects.toThrow(SsrfBlockedError);
    });
  });

  describe('size limits', () => {
    it('rejects a declared Content-Length above maxBytes before downloading the body', async () => {
      const dest = path.join(os.tmpdir(), `ssrf-test-declared-${Date.now()}.bin`);
      await expect(
        ssrfFetch.downloadToFile(`${baseUrl}/declared-too-large`, dest, { maxBytes: 1024 }),
      ).rejects.toThrow(/too large/i);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('aborts and deletes the partial file when the streamed body exceeds maxBytes even without a Content-Length header', async () => {
      const dest = path.join(os.tmpdir(), `ssrf-test-streamed-${Date.now()}.bin`);
      await expect(
        ssrfFetch.downloadToFile(`${baseUrl}/big-file`, dest, { maxBytes: 500 * 1024 }),
      ).rejects.toThrow(/exceeded/i);
      expect(fs.existsSync(dest)).toBe(false);
    }, 10000);
  });

  describe('timeouts', () => {
    it('aborts a request that never responds within timeoutMs', async () => {
      await expect(ssrfFetch.fetchHeaders(`${baseUrl}/slow`, { timeoutMs: 300 })).rejects.toThrow(/timed out/i);
    }, 5000);
  });
});
