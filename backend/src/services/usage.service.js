const db = require('../db/client');

/**
 * Append-only usage ledger (docs/COST.md §3) — never a mutated counter,
 * so usage is always auditable and quota checks are a straightforward
 * SUM query.
 */
async function recordAiRequest({ userId, processingJobId, amount = 1 }) {
  await db('usage_records').insert({
    user_id: userId,
    category: 'ai_requests',
    amount,
    processing_job_id: processingJobId || null,
    occurred_on: new Date().toISOString().slice(0, 10),
  });
}

async function countAiRequestsToday(userId) {
  const result = await db('usage_records')
    .where({ user_id: userId, category: 'ai_requests', occurred_on: new Date().toISOString().slice(0, 10) })
    .sum('amount as total')
    .first();
  return Number(result.total) || 0;
}

module.exports = { recordAiRequest, countAiRequestsToday };
