import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';

// Vite's config file runs BEFORE Vite reads .env files automatically. We
// load the .env explicitly here so the dev proxy and the runtime client
// code agree on the same backend port. The install script (Phase 3) is
// responsible for generating $OPENAIDY_HOME/.env with sensible defaults.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // OPENAIDY_PORT is the single source of truth for the backend's listen
  // port. Vite reads it at config time so the dev proxy can forward /api
  // and /ws to the correct backend target. No fallback — unset must fail
  // loudly so we don't silently proxy to a wrong port.
  const backendPort = env.OPENAIDY_PORT;
  if (!backendPort) {
    throw new Error(
      'OPENAIDY_PORT environment variable is required to build or serve the web app. ' +
        'Set it in your .env file (e.g. OPENAIDY_PORT=3001). ' +
        'The install script generates this file at $OPENAIDY_HOME/.env.',
    );
  }
  const backendTarget = `http://localhost:${backendPort}`;

  return {
    plugins: [solid()],
    resolve: {
      alias: {
        '@openaidy/sdk': fileURLToPath(
          new URL('../../packages/sdk/src/index.ts', import.meta.url),
        ),
        '@openaidy/shared-types': fileURLToPath(
          new URL('../../packages/shared-types/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      proxy: {
        // Forward REST calls and WS upgrades to the backend so client code
        // can use same-origin `/api` and `/ws` paths in dev.
        '/api': {
          target: backendTarget,
          changeOrigin: false,
        },
        '/ws': {
          target: backendTarget,
          ws: true,
          changeOrigin: false,
        },
      },
    },
    define: {
      // Vite only auto-exposes env vars prefixed with `VITE_` to client code.
      // The OpenAidy naming convention uses `OPENAIDY_VITE_*` (project-scoped
      // while still starting with `VITE_`), so we expose them explicitly here
      // — `JSON.stringify(undefined)` resolves to `undefined` when unset, which
      // the runtime check in api.ts/ws-provider.tsx surfaces as a clear error.
      'import.meta.env.OPENAIDY_VITE_SERVER_URL': JSON.stringify(
        env.OPENAIDY_VITE_SERVER_URL,
      ),
      'import.meta.env.OPENAIDY_VITE_WS_URL': JSON.stringify(
        env.OPENAIDY_VITE_WS_URL,
      ),
    },
  };
});
