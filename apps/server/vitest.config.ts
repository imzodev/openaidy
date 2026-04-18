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
  },
});
