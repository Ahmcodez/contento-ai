const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

describe('validation and error handling', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns a structured error shape for validation failures', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual(
      expect.objectContaining({ code: 'VALIDATION_ERROR', message: expect.any(String) }),
    );
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('returns 404 with a structured error for an unknown route', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('never leaks a stack trace in the response body', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'bad', password: 'x' });
    expect(JSON.stringify(res.body)).not.toMatch(/at Object|at process|\.js:\d+:\d+/);
  });

  it('rejects an oversized JSON body', async () => {
    const bigString = 'a'.repeat(2 * 1024 * 1024); // 2MB, over the 1MB json limit
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'big@example.com', password: 'password123', name: bigString });
    expect(res.status).toBe(413);
  });

  it('coerces and validates query params on list endpoints', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ email: 'qp@example.com', password: 'password123' });
    const res = await request(app)
      .get('/api/v1/projects?status=not-a-real-status')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(422);
  });

  it('applies security headers to every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
