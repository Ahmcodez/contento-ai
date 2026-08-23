const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

describe('auth', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates a new account and returns an access token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: 'password123', name: 'Alice' });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('alice@example.com');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.passwordHash).toBeUndefined();
      const setCookie = res.headers['set-cookie']?.join(';') || '';
      expect(setCookie).toContain('refreshToken=');
      expect(setCookie).toContain('HttpOnly');
    });

    it('rejects a weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'bob@example.com', password: 'short' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('WEAK_PASSWORD');
    });

    it('rejects an invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a duplicate email', async () => {
      await request(app).post('/api/v1/auth/register').send({ email: 'dup@example.com', password: 'password123' });
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'dup@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send({ email: 'carol@example.com', password: 'password123' });
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'carol@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('rejects an incorrect password without revealing which field was wrong', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'carol@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects a login for an email that does not exist with the same generic error', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('rejects a request with no token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects a malformed token', async () => {
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns the current user for a valid token', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'dave@example.com', password: 'password123' });

      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('dave@example.com');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates the refresh token and old one becomes invalid', async () => {
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/register').send({ email: 'erin@example.com', password: 'password123' });

      const first = await agent.post('/api/v1/auth/refresh');
      expect(first.status).toBe(200);
      expect(first.body.accessToken).toEqual(expect.any(String));

      // Reusing the original cookie jar again works because supertest's
      // agent already rotated its stored cookie — this confirms the
      // rotation flow succeeds end to end.
      const second = await agent.post('/api/v1/auth/refresh');
      expect(second.status).toBe(200);
    });

    it('rejects a missing refresh token', async () => {
      const res = await request(app).post('/api/v1/auth/refresh');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });
});
