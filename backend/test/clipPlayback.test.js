const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const { getStorageDriver } = require('../src/storage');
const { parseByteRange } = require('../src/utils/byteRange');
const { makeToken, verifyToken } = require('../src/services/clipPlayback.service');

const app = createApp();
const SIZE = 5000;
const FILE = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251)); // a recognisable, non-repeating-looking pattern
const THUMB = Buffer.from('fake-jpeg-bytes-for-the-poster-image');

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

/** A user's project with a job and a clip candidate; optionally a rendered clip file in real storage. */
async function seedClip(userId, { rendered = true, thumbnail = true } = {}) {
  const [ws] = await db('workspaces').where({ owner_id: userId });
  const [project] = await db('projects').insert({ workspace_id: ws.id, title: 'p', created_by: userId }).returning('*');
  const [asset] = await db('media_assets')
    .insert({ project_id: project.id, uploaded_by: userId, original_filename: 'a.mp4', storage_key: 'k', mime_type: 'video/mp4', size_bytes: 1, checksum_sha256: `c${Math.random()}`, status: 'validated' })
    .returning('*');
  const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'COMPLETED' }).returning('*');
  const [candidate] = await db('clip_candidates')
    .insert({ processing_job_id: job.id, start_ms: 0, end_ms: 30000, title: 'A clip', final_score: 80, rank: 1 })
    .returning('*');

  const base = `playback-test/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmp = path.join(os.tmpdir(), `pb-${Math.random().toString(36).slice(2)}`);
  let storageKey = null;
  let thumbKey = null;
  if (rendered) {
    fs.writeFileSync(tmp, FILE);
    storageKey = `${base}.mp4`;
    await getStorageDriver().saveFromPath(storageKey, tmp);
    if (thumbnail) {
      fs.writeFileSync(tmp, THUMB);
      thumbKey = `${base}.thumb.jpg`;
      await getStorageDriver().saveFromPath(thumbKey, tmp);
    }
    fs.rmSync(tmp, { force: true });
  }
  await db('generated_clips').insert({
    clip_candidate_id: candidate.id,
    storage_key: storageKey,
    thumbnail_storage_key: thumbKey,
    duration_seconds: 30,
    render_status: rendered ? 'rendered' : 'pending',
  });
  return { candidate, storageKey, thumbKey };
}

const mint = (token, clipId) => request(app).post(`/api/v1/clips/${clipId}/playback`).set('Authorization', `Bearer ${token}`);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const get = (url) => request(app).get(url).buffer(true).parse(binary);

beforeEach(async () => {
  await resetDb();
});

describe('parseByteRange', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=100-', { start: 100, end: SIZE - 1 }],
    ['bytes=-50', { start: SIZE - 50, end: SIZE - 1 }],
    ['bytes=4990-9999', { start: 4990, end: SIZE - 1 }], // end past the file is clamped
    ['bytes=-99999', { start: 0, end: SIZE - 1 }], // suffix longer than the file is the whole file
  ])('%s', (header, expected) => expect(parseByteRange(header, SIZE)).toEqual(expected));

  it.each(['bytes=5000-', 'bytes=6000-7000', 'bytes=-0', 'bytes=50-10'])('%s is unsatisfiable', (header) => {
    expect(parseByteRange(header, SIZE)).toBe('unsatisfiable');
  });

  it.each([undefined, '', 'bytes=', 'bytes=-', 'lines=0-5', 'bytes=0-5,10-20', 'garbage'])('%p is ignored (whole file)', (header) => {
    expect(parseByteRange(header, SIZE)).toBeNull();
  });
});

describe('POST /clips/:id/playback', () => {
  it('gives the owner a stream link and a poster link that expire', async () => {
    const user = await registerUser('pb1@example.com');
    const { candidate } = await seedClip(user.userId);

    const res = await mint(user.token, candidate.id);

    expect(res.status).toBe(200);
    expect(res.body.streamUrl).toMatch(new RegExp(`^/api/v1/clips/${candidate.id}/stream\\?t=\\d+\\.[\\w-]+$`));
    expect(res.body.posterUrl).toMatch(new RegExp(`^/api/v1/clips/${candidate.id}/thumbnail\\?t=`));
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('has no poster link when the clip has no thumbnail', async () => {
    const user = await registerUser('pb2@example.com');
    const { candidate } = await seedClip(user.userId, { thumbnail: false });
    expect((await mint(user.token, candidate.id)).body.posterUrl).toBeNull();
  });

  it('requires login, hides other people\'s clips, and refuses a clip that has not rendered', async () => {
    const owner = await registerUser('pb3@example.com');
    const other = await registerUser('pb4@example.com');
    const { candidate } = await seedClip(owner.userId);
    const pending = await seedClip(owner.userId, { rendered: false });

    expect((await request(app).post(`/api/v1/clips/${candidate.id}/playback`)).status).toBe(401);
    expect((await mint(other.token, candidate.id)).status).toBe(404);
    const notReady = await mint(owner.token, pending.candidate.id);
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.code).toBe('NOT_RENDERED');
  });
});

describe('GET /clips/:id/stream', () => {
  async function link() {
    const user = await registerUser(`pbs-${Math.random()}@example.com`);
    const clip = await seedClip(user.userId);
    const { body } = await mint(user.token, clip.candidate.id);
    return { ...clip, user, url: body.streamUrl, posterUrl: body.posterUrl };
  }

  it('plays without an Authorization header, sending the whole file with the headers a player needs', async () => {
    const { url } = await link();
    const res = await get(url);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(SIZE));
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin'); // otherwise the app's <video> can't load it
    expect(res.headers['cache-control']).toMatch(/private/);
    expect(res.body.equals(FILE)).toBe(true);
  });

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=1000-1999', 1000, 1999],
    ['bytes=4900-', 4900, SIZE - 1],
    ['bytes=-100', SIZE - 100, SIZE - 1],
    ['bytes=4990-99999', 4990, SIZE - 1],
  ])('answers Range %s with exactly those bytes (this is what makes seeking work)', async (header, start, end) => {
    const { url } = await link();
    const res = await get(url).set('Range', header);

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes ${start}-${end}/${SIZE}`);
    expect(res.headers['content-length']).toBe(String(end - start + 1));
    expect(res.body.equals(FILE.subarray(start, end + 1))).toBe(true);
  });

  it('answers a range outside the file with 416 and the real size', async () => {
    const { url } = await link();
    const res = await request(app).get(url).set('Range', 'bytes=9000-');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${SIZE}`);
  });

  it('ignores a Range it does not understand and sends the whole file', async () => {
    const { url } = await link();
    for (const header of ['bytes=0-5,10-20', 'nonsense']) {
       
      const res = await get(url).set('Range', header);
      expect(res.status).toBe(200);
      expect(res.body.equals(FILE)).toBe(true);
    }
  });

  it('answers HEAD with the headers and no body', async () => {
    const { url } = await link();
    const res = await request(app).head(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(SIZE));
    expect(res.text === undefined || res.text === '').toBe(true);
  });

  it('refuses a missing, malformed or tampered link', async () => {
    const { url, candidate } = await link();
    const base = `/api/v1/clips/${candidate.id}/stream`;
    const [exp, sig] = new URL(`http://x${url}`).searchParams.get('t').split('.');

    for (const bad of [base, `${base}?t=`, `${base}?t=garbage`, `${base}?t=${exp}.${sig.slice(0, -2)}xx`, `${base}?t=${Number(exp) + 100000}.${sig}`, `${base}?t=${exp}.${sig}.extra`]) {
       
      const res = await request(app).get(bad);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_PLAYBACK_LINK');
    }
  });

  it('refuses an expired link', async () => {
    const { candidate } = await link();
    const longAgo = Date.now() - 24 * 3600 * 1000;
    const { token } = makeToken('video', candidate.id, longAgo);
    const res = await request(app).get(`/api/v1/clips/${candidate.id}/stream?t=${token}`);
    expect(res.status).toBe(403);
  });

  it("a link for one clip does not open another, and a poster link does not open the video", async () => {
    const a = await link();
    const b = await link();
    const tokenA = new URL(`http://x${a.url}`).searchParams.get('t');

    expect((await request(app).get(`/api/v1/clips/${b.candidate.id}/stream?t=${tokenA}`)).status).toBe(403);
    expect(() => verifyToken('poster', a.candidate.id, tokenA)).toThrow(expect.objectContaining({ code: 'INVALID_PLAYBACK_LINK' }));
    const posterToken = new URL(`http://x${a.posterUrl}`).searchParams.get('t');
    expect((await request(app).get(`/api/v1/clips/${a.candidate.id}/stream?t=${posterToken}`)).status).toBe(403);
  });

  it('reports a missing file as 404 rather than crashing or hanging', async () => {
    const { url, storageKey } = await link();
    await getStorageDriver().delete(storageKey);
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });
});

describe('GET /clips/:id/thumbnail', () => {
  it('serves the poster image with a valid link only', async () => {
    const user = await registerUser('pbt1@example.com');
    const { candidate } = await seedClip(user.userId);
    const { body } = await mint(user.token, candidate.id);

    const res = await get(body.posterUrl);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.body.equals(THUMB)).toBe(true);

    expect((await request(app).get(`/api/v1/clips/${candidate.id}/thumbnail?t=bad`)).status).toBe(403);
  });
});
