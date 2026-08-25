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

module.exports = { create, findByEmail, findById };
