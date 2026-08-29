const request = require('supertest');

describe('TRUST_PROXY configuration', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function loadConfigWithTrustProxy(value) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    if (value === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = value;
    }
    // eslint-disable-next-line global-require
    return require('../src/config');
  }

  it('defaults to false (no proxy trusted) when TRUST_PROXY is unset — the safe default for local/Docker dev', () => {
    const config = loadConfigWithTrustProxy(undefined);
    expect(config.trustProxy).toBe(false);
  });

  it('parses the string "false" to the boolean false', () => {
    const config = loadConfigWithTrustProxy('false');
    expect(config.trustProxy).toBe(false);
  });

  it('parses the string "true" to the boolean true', () => {
    const config = loadConfigWithTrustProxy('true');
    expect(config.trustProxy).toBe(true);
  });

  it('parses a numeric string to a hop count, for a single load balancer in front of the app', () => {
    const config = loadConfigWithTrustProxy('1');
    expect(config.trustProxy).toBe(1);
  });

  it('parses a multi-digit numeric string to a hop count', () => {
    const config = loadConfigWithTrustProxy('3');
    expect(config.trustProxy).toBe(3);
  });

  it('passes through an Express-recognized keyword unchanged', () => {
    const config = loadConfigWithTrustProxy('loopback');
    expect(config.trustProxy).toBe('loopback');
  });
});

describe('app.js applies TRUST_PROXY to the Express app before rate limiting reads req.ip', () => {
  const ORIGINAL_ENV = { ...process.env };
  const express = require('express');
  const openHandles = [];

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    await Promise.all(
      openHandles.splice(0).map((handle) => {
        if (typeof handle.destroy === 'function') return handle.destroy(); // knex
        if (typeof handle.quit === 'function') return handle.quit(); // ioredis
        return Promise.resolve();
      }),
    ).catch(() => {});
  });

  function buildAppWithTrustProxy(value) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    if (value === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = value;
    }
    // eslint-disable-next-line global-require
    const createApp = require('../src/app');
    const app = createApp();
    // Each resetModules() cycle re-requires src/db/client.js and
    // src/redis/client.js fresh, opening a new pool/connection. Track and
    // close them so this file doesn't leak handles into the rest of the
    // suite when run with the other test files.
    // eslint-disable-next-line global-require
    openHandles.push(require('../src/db/client'), require('../src/redis/client'));
    return app;
  }

  it('with TRUST_PROXY unset, the real app has trust proxy disabled (false) — the safe default', () => {
    const app = buildAppWithTrustProxy(undefined);
    expect(app.get('trust proxy')).toBe(false);
  });

  it('with TRUST_PROXY=1, the real app has trust proxy set to a 1-hop count — this is what the rate limiter\'s req.ip-based keyGenerator actually reads', () => {
    const app = buildAppWithTrustProxy('1');
    expect(app.get('trust proxy')).toBe(1);
  });

  it('with TRUST_PROXY=true, the real app trusts the request unconditionally, matching what was configured', () => {
    const app = buildAppWithTrustProxy('true');
    expect(app.get('trust proxy')).toBe(true);
  });

  // The two tests above prove our config value reaches app.set('trust
  // proxy', ...) on the real app. This one demonstrates, independently of
  // our app's other middleware/routing, that Express's own trust-proxy
  // hop-count mechanism does what src/config/index.js's doc comment says
  // it does — a spoofed X-Forwarded-For is ignored with no trust proxy
  // configured, and honored once a hop count is configured.
  it('(Express mechanism sanity check) req.ip only reflects X-Forwarded-For once trust proxy is configured', async () => {
    const untrusted = express();
    untrusted.get('/whoami', (req, res) => res.json({ ip: req.ip }));
    const untrustedRes = await request(untrusted).get('/whoami').set('X-Forwarded-For', '203.0.113.7');
    expect(untrustedRes.body.ip).not.toBe('203.0.113.7');

    const trusted = express();
    trusted.set('trust proxy', 1);
    trusted.get('/whoami', (req, res) => res.json({ ip: req.ip }));
    const trustedRes = await request(trusted).get('/whoami').set('X-Forwarded-For', '203.0.113.7');
    expect(trustedRes.body.ip).toBe('203.0.113.7');
  });
});
