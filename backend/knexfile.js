require('dotenv').config();

module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: { directory: './migrations', tableName: 'knex_migrations' },
  },
  test: {
    client: 'pg',
    connection: process.env.DATABASE_URL_TEST || 'postgres://contento:contento@localhost:5432/contento_test',
    migrations: { directory: './migrations', tableName: 'knex_migrations' },
  },
};
