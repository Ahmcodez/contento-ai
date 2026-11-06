const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const config = require('../src/config');
const redis = require('../src/redis/client');
const { getStorageDriver } = require('../src/storage');
const { startWorkers, stopWorkers, wrapWithErrorPersistence } = require('../src/workers');
const { PHYSICAL_QUEUES, QUEUE_NAMES, STAGE_TO_QUEUE, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');
const store = require('../src/tools/downloader/jobStore');
const { sweep } = require('../src/tools/downloader/cleanup');
const processToolDownload = require('../src/workers/processors/toolDownload.processor');

const app = createApp();
const FAKE = path.join(__dirname, 'fixtures', 'fake-yt-dlp.js');
const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.mp4'));
const LOG = path.join(os.tmpdir(), 'fake-yt-dlp.log'); // the fake writes here; see fixtures/fake-yt-dlp.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settings = config.tools.downloader;
// Keep the per-visitor request limits out of the way of the functional tests; they have their own file.
settings.infoPerMinutePerIp = 100000;
settings.downloadsPerHourPerIp = 100000;
const originalSettings = { ...settings };
const originalYtdlp = { ...config.ytdlp };

const URL_OK = 'https://www.youtube.com/watch?v=abc123';
const info = (url) => request(app).post('/api/v1/tools/downloader/info').send({ url });
const create = (url, optionId) => request(app).post('/api/v1/tools/downloader/jobs').send({ url, optionId });
const status = (id) => request(app).get(`/api/v1/tools/downloader/jobs/${id}`);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const file = (id) => request(app).get(`/api/v1/tools/downloader/jobs/${id}/file`).buffer(true).parse(binary);
// file() reads bodies as raw bytes (it downloads video), so a JSON error comes back as a Buffer.
const errorOf = (res) => JSON.parse(res.body.toString()).error;
const logged = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function waitFor(id, states, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let body;
  while (Date.now() < deadline) {
     
    body = (await status(id)).body;
    if (states.includes(body.state)) return body;
     
    await sleep(150);
  }
  throw new Error(`download ${id} stayed ${body && body.state}, wanted ${states}`);
}

let workers;
beforeAll(() => {
  config.ytdlp.path = FAKE;
  workers = startWorkers();
});
afterAll(async () => {
  Object.assign(config.ytdlp, originalYtdlp);
  await stopWorkers(workers);
  await getPhysicalQueue(PHYSICAL_QUEUES.TOOL).obliterate({ force: true });
  await closeAllQueues();
  fs.rmSync(LOG, { force: true });
});
beforeEach(async () => {
  Object.assign(settings, originalSettings);
  fs.rmSync(LOG, { force: true });
  const keys = await redis.keys('tool:*');
  if (keys.length) await redis.del(...keys);
  await getPhysicalQueue(PHYSICAL_QUEUES.TOOL).obliterate({ force: true });
});

describe('POST /downloader/info (no login)', () => {
  it('describes the video and the formats that exist for it', async () => {
    const res = await info(URL_OK);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'youtube', title: 'Test: Video / Name?', durationSeconds: 120, uploader: 'Test Channel' });
    expect(res.body.thumbnailUrl).toBe('https://i.ytimg.com/vi/abc123/hq.jpg');
    expect(res.body.options.map((o) => o.id)).toEqual(['video-1080', 'video-720', 'video-360', 'video-144', 'audio-mp3']); // 2160p exists but is above the cap
  });

  it('makes one lookup for "show options" then "download", not two', async () => {
    await info(URL_OK);
    await info(URL_OK);
    await create(URL_OK, 'video-720');
    expect(logged().filter((a) => a.includes('-J'))).toHaveLength(1);
  });

  it('always asks yt-dlp for one video, never a playlist, and passes no cookies or proxy unless configured', async () => {
    await info(URL_OK);
    const [args] = logged();
    expect(args).toContain('--no-playlist');
    expect(args).not.toContain('--cookies');
    expect(args).not.toContain('--proxy');
  });

  it.each([
    ['not a url', 'INVALID_URL'],
    ['', null], // caught by request validation before the service sees it
    ['javascript:alert(1)', 'INVALID_URL'],
    ['file:///etc/passwd', 'INVALID_URL'],
    ['ftp://youtube.com/watch?v=1', 'INVALID_URL'],
    [`https://www.youtube.com/watch?v=${'x'.repeat(3000)}`, null],
  ])('rejects %p', async (url, code) => {
    const res = await info(url);
    expect(res.status).toBe(422);
    if (code) expect(res.body.error.code).toBe(code);
    expect(logged()).toHaveLength(0); // never reached yt-dlp
  });

  it.each([
    'https://example.com/video',
    'https://example.com/clip.mp4', // direct file links are an open-proxy risk, so not offered here
    'https://www.dropbox.com/s/abc/file.mp4?dl=0',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:4000/api/v1/jobs',
    'https://youtube.com.evil.example/watch?v=1',
    'https://notyoutube.com/watch?v=1',
  ])('refuses %s and never contacts it', async (url) => {
    const res = await info(url);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNSUPPORTED_SOURCE');
    expect(res.body.error.message).toMatch(/YouTube, TikTok, Vimeo/);
    expect(logged()).toHaveLength(0);
  });

  it('does not offer YouTube Music', async () => {
    const res = await info('https://music.youtube.com/watch?v=abc');
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/YouTube Music/);
    expect(logged()).toHaveLength(0);
  });

  it('accepts every supported site by hostname', async () => {
    for (const url of ['https://youtu.be/abc123', 'https://www.tiktok.com/@a/video/1', 'https://vimeo.com/123', 'https://www.facebook.com/watch?v=1', 'https://www.instagram.com/reel/abc', 'https://x.com/a/status/1', 'https://www.dailymotion.com/video/x1', 'https://www.reddit.com/r/a/comments/1']) {
       
      expect((await info(url)).status).toBe(200);
    }
  });

  it('refuses videos over the length limit, with the limit in the message', async () => {
    const res = await info('https://www.youtube.com/watch?v=long');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TOO_LONG');
    expect(res.body.error.message).toContain('60-minute');
  });

  it('refuses live streams', async () => {
    const res = await info('https://www.youtube.com/watch?v=live');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LIVE_STREAM');
  });

  it('explains private videos plainly instead of showing an error dump', async () => {
    const res = await info('https://www.youtube.com/watch?v=private');
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/private/i);
    expect(JSON.stringify(res.body)).not.toMatch(/Traceback|ERROR:|\/usr|node_modules/);
  });

  it('is switched off cleanly by the kill switch', async () => {
    settings.enabled = false;
    const res = await info(URL_OK);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TOOL_DISABLED');
    expect((await create(URL_OK, 'video-720')).status).toBe(503);
  });
});

describe('downloading a video', () => {
  it('prepares the file in the background, then serves it as an attachment', async () => {
    const created = await create(URL_OK, 'video-720');
    expect(created.status).toBe(202);
    expect(created.body.id).toMatch(/^[a-f0-9]{32}$/);

    const ready = await waitFor(created.body.id, ['ready', 'failed']);
    expect(ready).toMatchObject({ state: 'ready', filename: 'Test Video Name.mp4', sizeBytes: SAMPLE.length, optionLabel: 'MP4 · 720p', provider: 'youtube' });
    expect(new Date(ready.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const res = await file(created.body.id);
    expect(res.status).toBe(200);
    expect(res.body.equals(SAMPLE)).toBe(true);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Test Video Name\.mp4"/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('tells yt-dlp exactly what it should do, within the limits', async () => {
    const { body } = await create(URL_OK, 'video-720');
    await waitFor(body.id, ['ready']);
    const args = logged().find((a) => !a.includes('-J'));
    const format = args[args.indexOf('-f') + 1];
    expect(format).toContain('height<=720');
    expect(format).not.toContain('height<=1080');
    expect(args[args.indexOf('--max-filesize') + 1]).toBe(String(settings.maxFilesizeBytes));
    expect(args).toContain('--no-playlist');
    expect(args.slice(-2)).toEqual(['--', URL_OK]); // the URL can never be read as an option
    expect(args[args.indexOf('-o') + 1]).toContain(`tool-downloads${path.sep}${body.id}`);
  });

  it('makes an MP3 when asked for audio only', async () => {
    const { body } = await create(URL_OK, 'audio-mp3');
    const ready = await waitFor(body.id, ['ready', 'failed']);
    expect(ready).toMatchObject({ state: 'ready', filename: 'Test Video Name.mp3', optionLabel: 'MP3 · audio only' });

    const res = await file(body.id);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.body.subarray(0, 3).toString() === 'ID3' || res.body[0] === 0xff).toBe(true); // a real MP3, not renamed video
    const args = logged().find((a) => a.includes('-x'));
    expect(args).toEqual(expect.arrayContaining(['-x', '--audio-format', 'mp3']));
  });

  it('supports Range, so a dropped download can resume', async () => {
    const { body } = await create(URL_OK, 'video-720');
    await waitFor(body.id, ['ready']);

    const part = await request(app).get(`/api/v1/tools/downloader/jobs/${body.id}/file`).set('Range', 'bytes=100-199').buffer(true).parse(binary);
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${SAMPLE.length}`);
    expect(part.body.equals(SAMPLE.subarray(100, 200))).toBe(true);

    const bad = await request(app).get(`/api/v1/tools/downloader/jobs/${body.id}/file`).set('Range', 'bytes=99999999-');
    expect(bad.status).toBe(416);
  });

  it('removes its temporary working folder, whether it worked or not', async () => {
    const ok = await create(URL_OK, 'video-720');
    const bad = await create('https://www.youtube.com/watch?v=fail', 'video-720');
    await waitFor(ok.body.id, ['ready']);
    await waitFor(bad.body.id, ['failed']);
    for (const id of [ok.body.id, bad.body.id]) {
      expect(fs.existsSync(path.join(config.storage.tmpPath, 'tool-downloads', id))).toBe(false);
    }
  });

  it('reports a failed download plainly and keeps internals out of the answer', async () => {
    const { body } = await create('https://www.youtube.com/watch?v=fail', 'video-720');
    const failed = await waitFor(body.id, ['failed']);
    expect(failed.error).toMatch(/could not be downloaded/i);
    expect(failed.filename).toBeNull();
    expect(JSON.stringify(failed)).not.toMatch(/something unexpected|Traceback|ERROR:/);

    const res = await file(body.id);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('NOT_READY');
  });

  it('refuses a video whose sound was lost in the merge, rather than handing over a silent file', async () => {
    const { body } = await create('https://www.youtube.com/watch?v=noaudio', 'video-720');
    const failed = await waitFor(body.id, ['failed']);
    expect(failed.error).toMatch(/with sound/i);
  });

  it('refuses a file larger than the size limit, even if the site under-reported it', async () => {
    settings.maxFilesizeBytes = 1000; // the sample is ~50 KB
    const { body } = await create(URL_OK, 'video-720');
    const failed = await waitFor(body.id, ['failed']);
    expect(failed.error).toMatch(/larger than the .* limit/i);
    const keys = await getStorageDriver().list?.('tool-downloads').catch(() => []);
    expect(keys || []).toHaveLength(0);
  });

  it('never exposes the source URL, the storage location or who asked', async () => {
    const { body } = await create(URL_OK, 'video-720');
    const ready = await waitFor(body.id, ['ready']);
    expect(Object.keys(ready).sort()).toEqual(['error', 'expiresAt', 'filename', 'id', 'optionLabel', 'provider', 'sizeBytes', 'state', 'title']);
    expect(JSON.stringify(ready)).not.toMatch(/youtube\.com\/watch|tool-downloads|visitor/);
  });

  it.each(['video-9999', 'video-2160', 'video-50', 'bogus', 'video-720; rm -rf /', ''])('rejects the format %p before doing any work', async (optionId) => {
    const res = await create(URL_OK, optionId);
    expect(res.status).toBe(422);
    expect(await getPhysicalQueue(PHYSICAL_QUEUES.TOOL).getWaitingCount()).toBe(0);
  });

  it('answers 404 for downloads that do not exist, and 422 for malformed ids', async () => {
    const unknown = 'a'.repeat(32);
    expect((await status(unknown)).status).toBe(404);
    expect((await file(unknown)).status).toBe(404);
    expect((await status('../../etc/passwd')).status).toBeGreaterThanOrEqual(400);
    expect((await status('short')).status).toBe(422);
  });
});

describe('protecting the server', () => {
  it('caps how many downloads one visitor can have running at once, and frees the slot when one finishes', async () => {
    settings.maxActivePerIp = 1;
    const first = await create('https://www.youtube.com/watch?v=slow', 'video-720'); // takes ~1.5s
    expect(first.status).toBe(202);

    const second = await create(URL_OK, 'video-720');
    expect(second.status).toBe(429);

    await waitFor(first.body.id, ['ready']);
    expect((await create(URL_OK, 'video-720')).status).toBe(202);
  });

  it('refuses new downloads, politely, when the queue is already long', async () => {
    settings.maxQueueDepth = 0;
    const res = await create(URL_OK, 'video-720');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BUSY');
  });

  it('does not let a visitor read another visitor\'s count: the visitor key is a hash, not the address', async () => {
    await create('https://www.youtube.com/watch?v=slow', 'video-720').then((r) => waitFor(r.body.id, ['ready']));
    const keys = await redis.keys('tool:active:*');
    for (const k of keys) expect(k).not.toMatch(/127\.0\.0\.1|::1/);
  });
});

describe('cleanup', () => {
  it('deletes a finished file once it expires, and says so', async () => {
    const { body } = await create(URL_OK, 'video-720');
    const ready = await waitFor(body.id, ['ready']);
    const record = await store.get(body.id);
    await expect(getStorageDriver().size(record.storageKey)).resolves.toBe(SAMPLE.length);

    expect(await sweep({ now: new Date(ready.expiresAt).getTime() - 1000 })).toBe(0); // not yet
    expect(await sweep({ now: new Date(ready.expiresAt).getTime() + 1000 })).toBe(1);

    await expect(getStorageDriver().size(record.storageKey)).rejects.toThrow();
    expect((await status(body.id)).body.state).toBe('expired');
    const res = await file(body.id);
    expect(res.status).toBe(410);
    expect(errorOf(res).code).toBe('DOWNLOAD_EXPIRED');
  });

  it('stops serving a file as soon as it is past its expiry, even before the sweeper has run', async () => {
    const { body } = await create(URL_OK, 'video-720');
    await waitFor(body.id, ['ready']);
    await store.update(body.id, { expiresAt: Date.now() - 1000 });
    expect((await file(body.id)).status).toBe(410);
  });

  it('removes working folders a crashed worker left behind', async () => {
    const root = path.join(config.storage.tmpPath, 'tool-downloads');
    const stale = path.join(root, 'b'.repeat(32));
    const fresh = path.join(root, 'c'.repeat(32));
    fs.mkdirSync(stale, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    const old = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(stale, old, old);

    await sweep();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true); // an in-progress download is left alone
    fs.rmSync(fresh, { recursive: true, force: true });
  });
});

describe('worker plumbing', () => {
  it('runs on its own queue, apart from customers\' imports, with one attempt', () => {
    expect(STAGE_TO_QUEUE[QUEUE_NAMES.TOOL_DOWNLOAD]).toBe(PHYSICAL_QUEUES.TOOL);
    expect(PHYSICAL_QUEUES.TOOL).not.toBe(PHYSICAL_QUEUES.DOWNLOAD); // never shares a queue with customers' imports
    expect(require('../src/queue/queues').RETRY_CONFIG[QUEUE_NAMES.TOOL_DOWNLOAD].attempts).toBe(1);
  });

  it('ignores a job that is no longer waiting (already handled, or expired)', async () => {
    await processToolDownload({ data: { id: 'd'.repeat(32) } });
    expect(logged()).toHaveLength(0);
  });

  it('the failure wrapper copes with a stage that has no database row', async () => {
    const wrapped = wrapWithErrorPersistence(QUEUE_NAMES.TOOL_DOWNLOAD, async () => {
      throw new Error('boom');
    }, null);
    await expect(wrapped({ data: { id: 'x' }, id: '1', attemptsMade: 0, opts: { attempts: 1 } })).rejects.toThrow('boom');
  });
});

describe('optional proxy and cookies', () => {
  it('are passed to yt-dlp only when configured', async () => {
    config.ytdlp.proxy = 'http://proxy.example:8080';
    config.ytdlp.cookiesPath = '/run/secrets/cookies.txt';
    await info('https://vimeo.com/999');
    const args = logged().find((a) => a.includes('-J'));
    expect(args[args.indexOf('--proxy') + 1]).toBe('http://proxy.example:8080');
    expect(args[args.indexOf('--cookies') + 1]).toBe('/run/secrets/cookies.txt');
  });
});
