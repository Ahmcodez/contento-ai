const db = require('../db/client');

const TABLE = 'refresh_tokens';

async function create({ userId, tokenHash, expiresAt }) {
  const [row] = await db(TABLE)
    .insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
    .returning(['id']);
  return row;
}

async function findValidByHash(tokenHash) {
  return db(TABLE)
    .where({ token_hash: tokenHash })
    .whereNull('revoked_at')
    .andWhere('expires_at', '>', db.fn.now())
    .first();
}

async function revoke(id, replacedById = null) {
  await db(TABLE).where({ id }).update({ revoked_at: db.fn.now(), replaced_by_id: replacedById });
}

async function revokeAllForUser(userId) {
  await db(TABLE).where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
}

module.exports = { create, findValidByHash, revoke, revokeAllForUser };
