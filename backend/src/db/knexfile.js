require('dotenv').config();

/** @type {import('knex').Knex.Config} */
const base = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: '../../migrations',
    tableName: 'knex_migrations',
  },
  pool: { min: 0, max: 10 },
};

module.exports = {
  development: base,
  test: base,
  production: base,
};
