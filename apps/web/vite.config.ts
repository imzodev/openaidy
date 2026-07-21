import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';

// Vite loads this config via Node ESM (not via tsx/Vite's resolver), so
// relative imports from workspace packages cannot use bundler-style bare
// specifiers. We keep the default port constant inline here; the CLI's
// `openaidy start` propagates the resolved port to the Vite spawn env so
// production overrides still flow through. Keep this in sync with
// DEFAULT_SERVER_PORT in packages/config/src/env.ts.
const FALLBACK_BACKEND_PORT = '3001';

// Vite's config file runs BEFORE Vite reads .env files automatically. We
// load the .env explicitly here so the dev proxy and the runtime client
// code agree on the same backend port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // OPENAIDY_PORT is the single source of truth for the backend's listen
  // port. Vite reads it at config time so the dev proxy can forward /api
  // and /ws to the correct backend target. Falls back to FALLBACK_BACKEND_PORT
  // so `vite dev` and `vite build` work without any env config.
  const backendPort = env.OPENAIDY_PORT ?? FALLBACK_BACKEND_PORT;
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
        // Serve addon static files from the backend so the iframe in
        // AddonViewPage can load them same-origin. Without this proxy
        // an empty OPENAIDY_VITE_SERVER_URL makes the iframe point at
        // the Vite dev server itself, which falls back to the web app's
        // index.html for unknown paths — the iframe then renders the
        // web app sandboxed inside itself, triggering CORS / sandbox
        // errors that look like an addon bug.
        '/addons': {
          target: backendTarget,
          changeOrigin: false,
          // Bare addon URLs (e.g. /addons/pokedex-addon) are the SPA
          // parent page — let Vite serve index.html so the client router
          // renders AddonViewPage. Paths WITH an entry (e.g.
          // /addons/pokedex-addon/app/index.html) are the iframe contents
          // and must be proxied to the backend.
          bypass(req) {
            if (/^\/addons\/[^/]+\/?$/.test(req.url ?? '')) {
              return '/index.html';
            }
            return undefined;
          },
        },
        '/sdk': {
          target: backendTarget,
          changeOrigin: false,
        },
      },
    },
    define: {
      // Vite only auto-exposes env vars prefixed with `VITE_` to client code.
      // The OpenAidy naming convention uses `OPENAIDY_VITE_*` (project-scoped
      // while still starting with `VITE_`), so we expose them explicitly here.
      // Empty string means "same origin" — api.ts and ws-provider.tsx treat
      // it as a relative URL the browser resolves against the current host.
      'import.meta.env.OPENAIDY_VITE_SERVER_URL': JSON.stringify(
        env.OPENAIDY_VITE_SERVER_URL ?? '',
      ),
      'import.meta.env.OPENAIDY_VITE_WS_URL': JSON.stringify(
        env.OPENAIDY_VITE_WS_URL ?? '',
      ),
    },
  };
});
