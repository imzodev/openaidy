import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// https://vite.dev/config/
export default defineConfig({
  plugins: [solid()],

  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5174,
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
