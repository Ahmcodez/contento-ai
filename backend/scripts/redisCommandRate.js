/**
 * Measures how many Redis commands your setup issues while you do nothing.
 *
 *   npm run redis:rate            # sample for 60s (default)
 *   npm run redis:rate -- 120     # sample for 120s
 *
 * Start the worker (`npm run worker`) and/or API first, leave them idle,
 * then run this. It reads the server's own command counters twice and
 * prints the difference, so it works against any Redis that supports
 * INFO (verified against local Redis 7 only — if your managed provider
 * hides these counters, use its dashboard instead and compare the same
 * idle window before/after a change).
 *
 * Note: Redis' commandstats counts commands executed *inside* Lua scripts
 * (BullMQ runs most of its logic that way) as well as the outer
 * EVAL/EVALSHA call itself, so the total below is the higher figure. Some
 * managed providers bill only the outer call; the evalsha/eval and blocking
 * (bzpopmin) rows in the breakdown are the outer, client-issued ones.
 */
const IORedis = require('ioredis');
const config = require('../src/config');

const seconds = Number(process.argv[2]) || 60;

function parseStats(info) {
  const out = {};
  for (const line of info.split('\n')) {
    const m = line.match(/^cmdstat_([a-z0-9_|]+):calls=(\d+)/i);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

(async () => {
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const snap = async () => parseStats(await redis.info('commandstats'));
  const before = await snap();
  const clients = (await redis.client('LIST')).split('\n').filter(Boolean).length;
  console.log(`Sampling for ${seconds}s (leave your app idle)... connected clients: ${clients}`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const after = await snap();

  const rows = Object.keys(after)
    .map((cmd) => [cmd, (after[cmd] || 0) - (before[cmd] || 0)])
    .filter(([cmd, n]) => n > 0 && cmd !== 'info' && cmd !== 'client|list')
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);

  console.log(`\nCommands in ${seconds}s, including Lua-internal (excluding this tool's own INFO/CLIENT calls): ${total}`);
  console.log(`≈ ${Math.round((total / seconds) * 60)}/min   ≈ ${Math.round((total / seconds) * 86400).toLocaleString()}/day`);
  for (const [cmd, n] of rows.slice(0, 12)) console.log(`  ${cmd.padEnd(14)} ${n}`);
  await redis.quit();
})().catch((err) => {
  console.error('Could not read Redis command stats:', err.message);
  process.exit(1);
});
