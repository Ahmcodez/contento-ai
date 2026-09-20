const { execFileSync } = require('child_process');
const path = require('path');
const request = require('supertest');

// Captures the options every BullMQ Worker is constructed with, without
// opening real blocking Redis loops.
const workerCtorCalls = [];
jest.mock('bullmq', () => {
  const actual = jest.requireActual('bullmq');
  class FakeWorker {
    constructor(queueName, processor, opts) {
      workerCtorCalls.push({ queueName, opts });
    }
    on() {}
    async close() {}
  }
  return { ...actual, Worker: FakeWorker };
});

const config = require('../src/config');
const createApp = require('../src/app');
const db = require('../src/db/client');
const userRepository = require('../src/repositories/user.repository');
const { startWorkers, stopWorkers } = require('../src/workers');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config', 'index.js');

function loadConfigInSubprocess(envOverrides) {
  const env = {
    ...process.env,
    ...envOverrides,
    DATABASE_URL: 'postgres://x:x@localhost:5432/x',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'x'.repeat(20),
    JWT_REFRESH_SECRET: 'y'.repeat(20),
  };
  return execFileSync('node', ['-e', `require('${CONFIG_PATH}')`], { env, encoding: 'utf-8', stdio: 'pipe' });
}

describe('idle Redis polling tuning', () => {
  it('defaults: 30s idle heartbeat, BullMQ-default 30s stalled check', () => {
    expect(config.queue.drainDelaySeconds).toBe(30);
    expect(config.queue.stalledIntervalMs).toBe(30000);
  });

  it('passes drainDelay and stalledInterval to every Worker', async () => {
    workerCtorCalls.length = 0;
    const workers = startWorkers();
    expect(workerCtorCalls.length).toBeGreaterThanOrEqual(10);
    for (const { opts } of workerCtorCalls) {
      expect(opts.drainDelay).toBe(config.queue.drainDelaySeconds);
      expect(opts.stalledInterval).toBe(config.queue.stalledIntervalMs);
    }
    await stopWorkers(workers);
  });

  it('never changes the lock settings that guarantee crash recovery', () => {
    workerCtorCalls.length = 0;
    return (async () => {
      const workers = startWorkers();
      for (const { opts } of workerCtorCalls) {
        expect(opts.lockDuration).toBeUndefined(); // BullMQ default (30s) stays in force
        expect(opts.skipStalledCheck).toBeUndefined();
        expect(opts.skipLockRenewal).toBeUndefined();
        expect(opts.maxStalledCount).toBeUndefined();
      }
      await stopWorkers(workers);
    })();
  });

  it('refuses a stalled interval below the lock renew time', () => {
    expect(() => loadConfigInSubprocess({ QUEUE_STALLED_INTERVAL_MS: '5000' })).toThrow();
  });

  it('refuses a non-positive drain delay', () => {
    expect(() => loadConfigInSubprocess({ QUEUE_DRAIN_DELAY_SECONDS: '0' })).toThrow();
  });

  it('accepts sane overrides', () => {
    expect(() =>
      loadConfigInSubprocess({ QUEUE_DRAIN_DELAY_SECONDS: '60', QUEUE_STALLED_INTERVAL_MS: '60000' }),
    ).not.toThrow();
  });
});

describe('auth + poll query reduction', () => {
  const app = createApp();

  beforeAll(async () => {
    await global.resetDb();
  });

  async function register(email) {
    const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password123', name: 'Q' });
    return { token: res.body.accessToken, id: res.body.user.id };
  }

  // Counts knex statements issued while `fn` runs.
  async function countQueries(fn) {
    const seen = [];
    const listener = (q) => seen.push(String(q.sql));
    db.on('query', listener);
    try {
      await fn();
    } finally {
      db.removeListener('query', listener);
    }
    return seen;
  }

  it('findAuthById returns only what req.user needs — never password_hash', async () => {
    const { id } = await register('narrow@example.com');
    const user = await userRepository.findAuthById(id);
    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name', 'plan']);
    expect(user).not.toHaveProperty('password_hash');
  });

  it('findAuthById still hides soft-deleted users', async () => {
    const { id } = await register('deleted@example.com');
    await db('users').where({ id }).update({ deleted_at: db.fn.now() });
    expect(await userRepository.findAuthById(id)).toBeUndefined();
  });

  it('a soft-deleted user with a still-valid token is rejected', async () => {
    const { token, id } = await register('deleted2@example.com');
    await db('users').where({ id }).update({ deleted_at: db.fn.now() });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('GET /auth/me reads the user exactly once and keeps its response shape', async () => {
    const { token, id } = await register('me@example.com');
    let res;
    const queries = await countQueries(async () => {
      res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id, email: 'me@example.com', name: 'Q', plan: expect.any(String) } });
    expect(queries.filter((s) => /from "users"/.test(s))).toHaveLength(1);
  });

  it('GET /usage reads the users table exactly once and keeps its response shape', async () => {
    const { token } = await register('usage@example.com');
    let res;
    const queries = await countQueries(async () => {
      res = await request(app).get('/api/v1/usage').set('Authorization', `Bearer ${token}`);
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        plan: expect.any(String),
        quota: expect.any(Object),
        usage: expect.any(Object),
        configDefaults: expect.any(Object),
      }),
    );
    expect(queries.filter((s) => /from "users"/.test(s))).toHaveLength(1);
  });

  it('job status poll costs 2 queries (auth + job), and other users still get 404', async () => {
    const owner = await register('pollowner@example.com');
    const stranger = await register('pollstranger@example.com');
    const project = (
      await request(app).post('/api/v1/projects').set('Authorization', `Bearer ${owner.token}`).send({ title: 'p' })
    ).body.project;
    const [asset] = await db('media_assets')
      .insert({
        project_id: project.id,
        uploaded_by: owner.id,
        storage_key: 'k',
        original_filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1,
        checksum_sha256: 'c'.repeat(64),
        status: 'uploaded',
      })
      .returning('*');
    const [job] = await db('processing_jobs').insert({ media_asset_id: asset.id, state: 'UPLOADED' }).returning('*');

    let ok;
    const queries = await countQueries(async () => {
      ok = await request(app).get(`/api/v1/jobs/${job.id}`).set('Authorization', `Bearer ${owner.token}`);
    });
    expect(ok.status).toBe(200);
    expect(ok.body.id ?? ok.body.job?.id).toBe(job.id);
    expect(queries).toHaveLength(2);

    const denied = await request(app).get(`/api/v1/jobs/${job.id}`).set('Authorization', `Bearer ${stranger.token}`);
    expect(denied.status).toBe(404);
  });
});
