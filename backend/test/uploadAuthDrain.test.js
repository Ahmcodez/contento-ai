const http = require('http');
const createApp = require('../src/app');

/**
 * Regression test for a real incident: requireAuth runs before multer on
 * the media upload route (deliberately — no reason to burn disk I/O on an
 * unauthenticated upload), so an invalid/missing token gets rejected
 * before the multipart body is ever read. If the server sends its error
 * response without draining or closing the still-incoming request body,
 * a real (large) video upload stalls forever: the client keeps trying to
 * write bytes into a socket nobody server-side is reading, TCP
 * backpressure kicks in, and the browser's upload progress just freezes
 * with no error ever surfaced. See errorHandler.js for the fix.
 *
 * This uses a raw http.request with a large streamed body — rather than
 * supertest, which buffers the whole payload before sending — because
 * the bug only manifests when the write is still in flight when the
 * early response comes back.
 */
describe('unauthenticated upload does not hang the connection', () => {
  let server;
  let port;

  beforeAll((done) => {
    const app = createApp();
    server = app.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('closes the connection promptly instead of stalling client writes after an early 401', (done) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: '/api/v1/projects/00000000-0000-0000-0000-000000000000/media',
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      // No Authorization header — requireAuth rejects before multer runs.
    });

    let respondedWith401 = false;
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hangTimer);
      done(err);
    };

    // If the bug regresses, the client's writes stall forever and neither
    // 'error' nor 'close' ever fires — this timeout is what catches that,
    // well under Jest's own per-test timeout.
    const hangTimer = setTimeout(() => {
      finish(new Error('client write stalled — request body was never drained/closed after the early response'));
    }, 8000);

    req.on('response', (res) => {
      respondedWith401 = res.statusCode === 401;
      res.resume();
    });

    // A destroyed request surfaces as a write/socket error on the client
    // once it tries to push more data through — this is the expected,
    // correct outcome (fast, clear failure instead of a silent hang).
    req.on('error', () => {
      expect(respondedWith401).toBe(true);
      finish();
    });

    req.on('close', () => {
      expect(respondedWith401).toBe(true);
      finish();
    });

    // Keep writing well past the point where the 401 comes back, to
    // reproduce a real large-file upload still in flight when the
    // rejection happens.
    const chunk = Buffer.alloc(64 * 1024, 'x');
    const totalChunks = 800; // ~50MB
    let sent = 0;

    function pump() {
      let ok = true;
      while (sent < totalChunks && ok) {
        ok = req.write(chunk);
        sent += 1;
      }
      if (sent < totalChunks) {
        req.once('drain', pump);
      } else {
        req.end();
      }
    }
    pump();
  });
});
