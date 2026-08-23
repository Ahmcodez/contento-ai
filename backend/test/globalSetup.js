const knex = require('knex');

module.exports = async () => {
  require('./env');

  const db = knex({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: { directory: './migrations' },
  });

  await db.migrate.latest();
  await db.destroy();
};
