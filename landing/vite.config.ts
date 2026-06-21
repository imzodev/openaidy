import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { join } from 'path';

function runOgGenerator() {
  try {
    execSync(
      `node "${join(__dirname, 'scripts', 'generate-og.mjs')}" --page home`,
      {
        stdio: 'inherit',
        cwd: __dirname,
      },
    );
    execSync(
      `node "${join(__dirname, 'scripts', 'generate-og.mjs')}" --page tutorials`,
      {
        stdio: 'inherit',
        cwd: __dirname,
      },
    );
    execSync(
      `node "${join(__dirname, 'scripts', 'generate-og.mjs')}" --page blog`,
      {
        stdio: 'inherit',
        cwd: __dirname,
      },
    );
    console.log('[OG] Open Graph images ready.');
  } catch (err) {
    console.warn(
      '[OG] Warning: OG image generation failed, continuing anyway.',
      (err as Error).message,
    );
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'openaidy-og-images',
      closeBundle() {
        runOgGenerator();
      },
    },
    react(),
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});
