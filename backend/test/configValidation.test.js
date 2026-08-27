/**
 * Config validation runs process.exit(1) on failure, which we can't
 * call inside a normal test — this spawns a real child process instead,
 * the only honest way to verify "the app refuses to boot" without
 * killing the test runner itself.
 */
const { execFileSync } = require('child_process');
const path = require('path');

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
  return execFileSync('node', ['-e', `require('${CONFIG_PATH}')`], { env, encoding: 'utf-8' });
}

describe('config fail-fast validation', () => {
  it('refuses to boot when STORAGE_DRIVER=s3 but S3_BUCKET is missing', () => {
    expect(() => loadConfigInSubprocess({ STORAGE_DRIVER: 's3' })).toThrow();
  });

  it('boots fine when STORAGE_DRIVER=s3 and S3_BUCKET is set', () => {
    expect(() => loadConfigInSubprocess({ STORAGE_DRIVER: 's3', S3_BUCKET: 'my-bucket' })).not.toThrow();
  });

  it('boots fine with the default local storage driver', () => {
    expect(() => loadConfigInSubprocess({})).not.toThrow();
  });

  it('refuses to boot with a JWT secret that is too short', () => {
    expect(() =>
      execFileSync('node', ['-e', `require('${CONFIG_PATH}')`], {
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://x:x@localhost:5432/x',
          REDIS_URL: 'redis://localhost:6379',
          JWT_ACCESS_SECRET: 'short',
          JWT_REFRESH_SECRET: 'y'.repeat(20),
        },
        encoding: 'utf-8',
      }),
    ).toThrow();
  });
});
