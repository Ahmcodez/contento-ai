module.exports = async () => {
  // Nothing to tear down globally — each test file closes its own
  // knex/redis connections in its afterAll hook (see test/setup.js).
};
