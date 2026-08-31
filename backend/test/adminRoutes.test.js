const request = require('supertest');

describe('admin routes (queue observability)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function buildAppWithAdminKey(value) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    if (value === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = value;
    }
    // eslint-disable-next-line global-require
    const createApp = require('../src/app');
    return createApp();
  }

  it('returns 404 (not 401) when no ADMIN_API_KEY is configured — disabled, not "open with an easy default"', async () => {
    const app = buildAppWithAdminKey(undefined);
    const res = await request(app).get('/api/v1/admin/queues');
    expect(res.status).toBe(404);
  });

  it('returns 401 when a key is configured but the request has none', async () => {
    const app = buildAppWithAdminKey('supersecret');
    const res = await request(app).get('/api/v1/admin/queues');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the provided X-Admin-Key does not match', async () => {
    const app = buildAppWithAdminKey('supersecret');
    const res = await request(app).get('/api/v1/admin/queues').set('X-Admin-Key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns real per-queue job counts when the key matches, reflecting an actually-enqueued job', async () => {
    const app = buildAppWithAdminKey('supersecret');
    // eslint-disable-next-line global-require
    const { enqueueVideoValidate } = require('../src/queue/producers');
    // eslint-disable-next-line global-require
    const { QUEUE_NAMES, getQueue, closeAllQueues } = require('../src/queue/queues');

    await getQueue(QUEUE_NAMES.VIDEO_VALIDATE).drain();
    await enqueueVideoValidate({ processingJobId: 'admin-test-job', mediaAssetId: 'admin-test-asset' });

    try {
      const res = await request(app).get('/api/v1/admin/queues').set('X-Admin-Key', 'supersecret');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(Object.values(QUEUE_NAMES).length);

      const videoValidateSummary = res.body.data.find((s) => s.queue === QUEUE_NAMES.VIDEO_VALIDATE);
      expect(videoValidateSummary.counts.waiting).toBeGreaterThanOrEqual(1);
    } finally {
      await closeAllQueues();
    }
  });
});
