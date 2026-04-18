import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setup.test.ts'],
    exclude: ['node_modules', 'dist', '**/*.config.*', '**/setup.test.ts'],
  },
});
