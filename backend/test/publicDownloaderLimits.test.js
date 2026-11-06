const request = require('supertest');
const createApp = require('../src/app');
const config = require('../src/config');
const redis = require('../src/redis/client');
const { PHYSICAL_QUEUES, getPhysicalQueue, closeAllQueues } = require('../src/queue/queues');

const app = createApp();
const FAKE = require('path').join(__dirname, 'fixtures', 'fake-yt-dlp.js');
const settings = config.tools.downloader;
const original = { ...settings };
const originalGeneral = config.rateLimit.maxRequests;
const originalPath = config.ytdlp.path;

const info = () => request(app).post('/api/v1/tools/downloader/info').send({ url: 'https://www.youtube.com/watch?v=abc123' });
const create = () => request(app).post('/api/v1/tools/downloader/jobs').send({ url: 'https://www.youtube.com/watch?v=abc123', optionId: 'video-720' });

beforeEach(async () => {
  Object.assign(settings, original);
  config.rateLimit.maxRequests = originalGeneral;
  config.ytdlp.path = FAKE;
  const keys = await redis.keys('tool:*');
  if (keys.length) await redis.del(...keys);
  await getPhysicalQueue(PHYSICAL_QUEUES.TOOL).obliterate({ force: true });
});
afterAll(async () => {
  config.ytdlp.path = originalPath;
  config.rateLimit.maxRequests = originalGeneral;
  await getPhysicalQueue(PHYSICAL_QUEUES.TOOL).obliterate({ force: true });
  await closeAllQueues();
});

// Each visitor's own limits. (Every request here comes from one address, as in production
// from a single visitor. The limiters are in-memory under test and Redis-backed otherwise.)
describe('per-visitor limits on the public downloader', () => {
  it('limits link lookups per minute, then says to wait', async () => {
    Object.assign(settings, { infoPerMinutePerIp: 3, downloadsPerHourPerIp: 1000 });
    // Each limiter keeps its own counter, so use a path nothing else in this file has hit yet.
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
       
      statuses.push((await info()).status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('limits how many downloads one visitor can start per hour, separately from lookups', async () => {
    Object.assign(settings, { infoPerMinutePerIp: 100000, downloadsPerHourPerIp: 2, maxActivePerIp: 100 });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
       
      statuses.push((await create()).status);
    }
    expect(statuses.filter((s) => s === 202).length).toBeLessThanOrEqual(2);
    expect(statuses.slice(-1)).toEqual([429]);
  });
});

describe('status polling', () => {
  it('does not use up the general API budget, so watching a download never locks a visitor out', async () => {
    Object.assign(settings, { infoPerMinutePerIp: 100000 });
    config.rateLimit.maxRequests = 5;

    const unknown = 'a'.repeat(32);
    const polls = [];
    for (let i = 0; i < 25; i += 1) {
       
      polls.push((await request(app).get(`/api/v1/tools/downloader/jobs/${unknown}`)).status);
    }
    expect(polls.every((s) => s === 404)).toBe(true); // a real answer every time, never 429

    // ...while ordinary calls are still held to the general limit, so the exemption is narrow.
    const others = [];
    for (let i = 0; i < 8; i += 1) {
       
      others.push((await info()).status);
    }
    expect(others).toContain(429);
  });
});
