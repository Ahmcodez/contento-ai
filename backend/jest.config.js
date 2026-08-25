module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  setupFiles: ['<rootDir>/test/env.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  globalSetup: '<rootDir>/test/globalSetup.js',
  globalTeardown: '<rootDir>/test/globalTeardown.js',
};
