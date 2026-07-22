import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Run tests sequentially to avoid test isolation issues
    fileParallelism: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        maxWorkers: 1,
        minWorkers: 1,
      },
    },
    // Increase default timeout for all tests
    testTimeout: 15000,
    // Suppress console output from passing tests so the run stays readable.
    // Logs are still captured and printed for any test that FAILS, so
    // debugging isn't hurt. This hides the app's routine startup logs
    // (WorkspaceService init, bootstrap token, web-bundle notice, request
    // lines) that otherwise bury the actual results.
    silent: 'passed-only',
  },
});
