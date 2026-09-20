const db = require('../db/client');

const TABLE = 'users';

async function create({ email, passwordHash, name }) {
  const [user] = await db(TABLE)
    .insert({ email, password_hash: passwordHash, name })
    .returning(['id', 'email', 'name', 'plan', 'created_at']);
  return user;
}

async function findByEmail(email) {
  return db(TABLE).whereNull('deleted_at').andWhere({ email }).first();
}

async function findById(id) {
  return db(TABLE).whereNull('deleted_at').andWhere({ id }).first();
}

/**
 * Per-request auth lookup. Runs on every authenticated API call, so it
 * selects only the columns req.user needs — notably NOT password_hash,
 * which `select *` was pulling into memory on every single request.
 * Still filters deleted_at, so a soft-deleted user's token stops working.
 */
async function findAuthById(id) {
  return db(TABLE).whereNull('deleted_at').andWhere({ id }).first('id', 'email', 'name', 'plan');
}

module.exports = { create, findByEmail, findById, findAuthById };
