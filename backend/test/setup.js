const db = require('../src/db/client');
const redis = require('../src/redis/client');

const TRUNCATE_TABLES = [
  'processing_errors',
  'processing_job_events',
  'processing_jobs',
  'media_assets',
  'projects',
  'refresh_tokens',
  'workspace_members',
  'workspaces',
  'users',
];

async function resetDb() {
  await db.raw(`TRUNCATE TABLE ${TRUNCATE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

afterAll(async () => {
  await db.destroy();
  await redis.quit();
});

global.resetDb = resetDb;
