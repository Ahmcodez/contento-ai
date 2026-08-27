const request = require('supertest');
const createApp = require('../src/app');
const db = require('../src/db/client');
const config = require('../src/config');
const quotaService = require('../src/services/quota.service');

const app = createApp();

async function registerUser(email) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

describe('project and processing-minutes quotas', () => {
  beforeEach(async () => {
    await resetDb();
    await db('usage_records').del();
  });

  describe('max projects per user', () => {
    it('rejects project creation once the limit is reached', async () => {
      const { token } = await registerUser('projectlimit@example.com');
      const originalLimit = config.limits.maxProjectsPerUser;
      config.limits.maxProjectsPerUser = 2;

      try {
        await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'One' });
        await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Two' });
        const res = await request(app)
          .post('/api/v1/projects')
          .set('Authorization', `Bearer ${token}`)
          .send({ title: 'Three' });

        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
      } finally {
        config.limits.maxProjectsPerUser = originalLimit;
      }
    });

    it('allows project creation under the limit', async () => {
      const { token } = await registerUser('underlimit@example.com');
      const res = await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Fine' });
      expect(res.status).toBe(201);
    });
  });

  describe('monthly processing minutes quota', () => {
    it('rejects an addition that would exceed the monthly limit', async () => {
      const { userId } = await registerUser('minutes1@example.com');
      const originalLimit = config.limits.maxProcessingMinutesPerUserPerMonth;
      config.limits.maxProcessingMinutesPerUserPerMonth = 10;

      try {
        await quotaService.recordProcessingMinutes(userId, null, 8);
        await expect(quotaService.assertWithinMonthlyProcessingMinutes(userId, 5)).rejects.toThrow(/monthly limit/);
      } finally {
        config.limits.maxProcessingMinutesPerUserPerMonth = originalLimit;
      }
    });

    it('allows an addition within the monthly limit', async () => {
      const { userId } = await registerUser('minutes2@example.com');
      const originalLimit = config.limits.maxProcessingMinutesPerUserPerMonth;
      config.limits.maxProcessingMinutesPerUserPerMonth = 100;

      try {
        await quotaService.recordProcessingMinutes(userId, null, 8);
        await expect(quotaService.assertWithinMonthlyProcessingMinutes(userId, 5)).resolves.toBeUndefined();
      } finally {
        config.limits.maxProcessingMinutesPerUserPerMonth = originalLimit;
      }
    });

    it('only counts usage from the current calendar month', async () => {
      const { userId } = await registerUser('minutes3@example.com');
      const originalLimit = config.limits.maxProcessingMinutesPerUserPerMonth;
      config.limits.maxProcessingMinutesPerUserPerMonth = 10;

      try {
        await db('usage_records').insert({
          user_id: userId,
          category: 'upload_minutes',
          amount: 9,
          occurred_on: '2020-01-01', // long past month
        });
        // Should not be blocked by the old month's usage.
        await expect(quotaService.assertWithinMonthlyProcessingMinutes(userId, 5)).resolves.toBeUndefined();
      } finally {
        config.limits.maxProcessingMinutesPerUserPerMonth = originalLimit;
      }
    });
  });

  describe('recordClipRendered', () => {
    it('writes a real usage_records row that the usage endpoint reflects', async () => {
      const { token, userId } = await registerUser('cliprecord@example.com');
      await quotaService.recordClipRendered(userId, null);

      const res = await request(app).get('/api/v1/usage').set('Authorization', `Bearer ${token}`);
      expect(res.body.usage.clipsRenderedThisMonth).toBe(1);
    });
  });
});
