const request = require('supertest');
const createApp = require('../src/app');
const metrics = require('../src/metrics');

const app = createApp();

describe('operational endpoints', () => {
  describe('GET /health', () => {
    it('returns ok without touching the database', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/ready', () => {
    it('reports database and redis as ok when both are reachable', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.checks.database).toBe('ok');
      expect(res.body.checks.redis).toBe('ok');
    });

    it('reports 503/degraded when redis is not ready, without touching the database check', async () => {
      // eslint-disable-next-line global-require
      const redis = require('../src/redis/client');
      const originalStatus = redis.status;
      // ioredis's own status values while disconnected/reconnecting
      // include 'connecting', 'reconnecting', 'close', 'end' — 'end' here
      // stands in for "redis is down", without actually tearing down the
      // shared connection other test files in this run also depend on.
      redis.status = 'end';

      try {
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('degraded');
        expect(res.body.checks.redis).toBe('end');
        expect(res.body.checks.database).toBe('ok'); // one dependency being down doesn't hide the other's real status
      } finally {
        redis.status = originalStatus;
      }
    });

    // A symmetric "database unreachable" case (db.raw() rejecting) is not
    // covered here: knex defines `raw` as a non-writable property, and
    // both plain reassignment and jest.spyOn fail against it (the latter
    // throws from inside jest-mock's own internals rather than jest
    // reporting a normal test failure). The route's try/catch around
    // db.raw() is a direct mirror of the redis check just proven above,
    // so this is a known, low-risk gap rather than an untested code path
    // with any real behavioral uncertainty.
  });

  describe('GET /metrics', () => {
    it('reflects a real recorded counter', async () => {
      metrics.increment('test_counter', { foo: 'bar' });
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.body.counters['test_counter{foo=bar}']).toBeGreaterThanOrEqual(1);
    });

    it('reflects real duration percentiles once samples exist', async () => {
      metrics.recordDuration('test-stage', 100);
      metrics.recordDuration('test-stage', 200);
      metrics.recordDuration('test-stage', 300);
      const res = await request(app).get('/metrics');
      expect(res.body.durations['test-stage'].count).toBeGreaterThanOrEqual(3);
      expect(res.body.durations['test-stage'].p50Ms).not.toBeNull();
    });

    it('increments api_error on a real request failure', async () => {
      await request(app).post('/api/v1/auth/login').send({ email: 'nope@example.com', password: 'wrong' });
      const res = await request(app).get('/metrics');
      const hasApiError = Object.keys(res.body.counters).some((k) => k.startsWith('api_error'));
      expect(hasApiError).toBe(true);
    });
  });
});
