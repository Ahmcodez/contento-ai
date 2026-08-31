const js = require('@eslint/js');
const jestPlugin = require('eslint-plugin-jest');
const globals = require('globals');

// backend/package.json's `lint` script (`eslint src test`) had no
// eslint installed or configured at all before this — found during a
// production-readiness review (docs/RELEASE_READINESS.md). Kept
// deliberately minimal: this is a plain CommonJS Node app, not a
// framework project, so a small, mostly-recommended-defaults config is
// the right amount of tooling rather than pulling in a larger preset
// built for a different stack.
module.exports = [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...jestPlugin.environments.globals.globals, resetDb: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
];
