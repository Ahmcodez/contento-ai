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
