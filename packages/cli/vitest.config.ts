import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Never let lifecycle tests drive a real systemd unit on the host.
    env: { OPENAIDY_NO_SERVICE: '1' },
  },
});
