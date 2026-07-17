import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../lib/env';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import { signAssetToken, verifyAssetToken } from '../lib/asset-token';
import { createAddonService } from '../addons/service';
import type { AddonsRepository } from '@openaidy/db';
import type { ManifestValidator } from '../addons/manifest-validator';
import {
  parseComponentManifest,
  type ComponentManifest,
} from '../addons/component-manifest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_SCOPE = '*';

// Asset tokens are short-lived; the addon's static assets all load within
// seconds of the iframe navigation, so a small window is plenty.
const ASSET_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * The Tailwind Play CDN origin every addon's `index.html` auto-loads (see
 * `tools/addons/create.ts`). This is a fixed PLATFORM allowance, not derived
 * from a given addon's `externalDomains` — those only ever feed
 * `connect-src`/`img-src` (fetch/XHR and images), never `script-src`, and we
 * deliberately don't widen `script-src` to arbitrary addon-declared domains
 * (an addon declaring an API host for fetch() should not thereby also be
 * allowed to load a <script> from that same host). Tailwind is a built-in
 * platform feature every addon gets, so it gets its own explicit allowance.
 */
const TAILWIND_CDN_ORIGIN = 'https://cdn.tailwindcss.com';

/**
 * Append an asset token to a same-origin subresource URL. External, absolute,
 * protocol-relative, and special-scheme URLs are left untouched.
 */
function appendAssetToken(url: string, token: string): string {
  if (
    /^(https?:)?\/\//i.test(url) ||
    /^(data:|blob:|mailto:|tel:|javascript:|#)/i.test(url)
  ) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}at=${encodeURIComponent(token)}`;
}

/**
 * Rewrite an addon HTML document so the sandboxed iframe can load its
 * subresources: propagate the asset token onto every local `src`/`href`, and
 * mark scripts `crossorigin="anonymous"` (CORS mode) so strict dev servers
 * don't reject the cross-origin no-cors loads.
 */
function rewriteAddonHtml(html: string, token: string): string {
  const withTokens = html.replace(
    /\b(src|href)=("|')(.*?)\2/gi,
    (_match, attr: string, quote: string, url: string) =>
      `${attr}=${quote}${appendAssetToken(url, token)}${quote}`,
  );
  return withTokens.replace(
    /<script(?![^>]*\bcrossorigin\b)([^>]*\bsrc=)/gi,
    '<script crossorigin="anonymous"$1',
  );
}

/** Extract the `at` asset-token query param from a request. */
function getAssetToken(request: FastifyRequest): string | null {
  const query = request.query as Record<string, unknown> | undefined;
  const at = query?.['at'];
  return typeof at === 'string' && at.length > 0 ? at : null;
}

/**
 * Addon routes options
 */
export type AddonRoutesOptions = {
  addonsRepository: AddonsRepository;
  authMiddleware: AuthMiddleware;
  jwtSecret: string;
  openAidyVersion: string;
  manifestValidator: ManifestValidator;
  storageEngine?: import('../addons/storage/engine').AddonStorageEngine;
};

/**
 * Standard error response
 */
interface ErrorResponse {
  error: string;
  message: string;
}

/**
 * Install addon request body
 */
interface InstallAddonBody {
  manifest: Record<string, unknown>;
}

/**
 * Enable addon request body
 */
interface EnableAddonBody {
  approvedPermissions: string[];
}

/**
 * Update config request body
 */
interface UpdateConfigBody {
  config: Record<string, unknown>;
}

/**
 * List addons query
 */
interface ListAddonsQuery {
  status?: string;
  limit?: string;
  offset?: string;
}

/**
 * Addon routes plugin
 */
export const addonRoutes: FastifyPluginAsync<AddonRoutesOptions> = async (
  app,
  opts,
) => {
  const adminAuth = requireAuth({
    authMiddleware: opts.authMiddleware,
    requiredScope: ADMIN_SCOPE,
  });

  // Create the addon service
  const addonService = createAddonService({
    repository: opts.addonsRepository,
    validator: opts.manifestValidator,
    jwtSecret: opts.jwtSecret,
    openAidyVersion: opts.openAidyVersion,
  });

  // POST /api/addons - Install new addon
  app.post<{ Body: InstallAddonBody; Reply: unknown }>(
    '/api/addons',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { manifest } = request.body;

        if (!manifest || typeof manifest !== 'object') {
          return reply.code(400).send({
            error: 'INVALID_REQUEST',
            message: 'Manifest is required',
          });
        }

        const result = await addonService.installAddon({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          manifest: manifest as any,
          installedBy: 'admin',
        });

        return reply.code(201).send(result);
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'DUPLICATE_ADDON_ID') {
          return reply.code(409).send({
            error: 'DUPLICATE_ADDON',
            message: err.message ?? 'Addon already exists',
          });
        }
        if (err.code === 'INVALID_MANIFEST') {
          return reply.code(400).send({
            error: 'INVALID_MANIFEST',
            message: err.message ?? 'Invalid manifest',
          });
        }
        throw error;
      }
    },
  );

  // GET /api/addons - List addons
  app.get<{
    Querystring: ListAddonsQuery;
    Reply: unknown;
  }>('/api/addons', { preHandler: adminAuth }, async (request, reply) => {
    const { status, limit, offset } = request.query;

    const result = await addonService.listAddons({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: status as any,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    return reply.send(result);
  });

  // GET /api/addons/:addonId - Get addon details
  app.get<{
    Params: { addonId: string };
    Reply: unknown;
  }>(
    '/api/addons/:addonId',
    { preHandler: adminAuth },
    async (request, reply) => {
      const addon = await addonService.getAddon(request.params.addonId);

      if (!addon) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Addon not found',
        });
      }

      return reply.send({ addon });
    },
  );

  // PUT /api/addons/:addonId - Update addon configuration
  app.put<{
    Params: { addonId: string };
    Body: UpdateConfigBody;
    Reply: unknown;
  }>(
    '/api/addons/:addonId',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const addon = await addonService.updateAddonConfig({
          addonId: request.params.addonId,
          config: request.body.config || {},
          updatedBy: 'admin',
        });

        return reply.send({ addon });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'ADDON_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NOT_FOUND',
            message: err.message ?? 'Addon not found',
          });
        }
        if (err.code === 'INVALID_CONFIG') {
          return reply.code(400).send({
            error: 'INVALID_CONFIG',
            message: err.message ?? 'Invalid configuration',
          });
        }
        throw error;
      }
    },
  );

  // DELETE /api/addons/:addonId - Uninstall addon
  app.delete<{
    Params: { addonId: string };
    Reply: void | ErrorResponse;
  }>(
    '/api/addons/:addonId',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        await addonService.uninstallAddon(request.params.addonId, 'admin');
        // Close the storage connection and delete the addon's on-disk
        // directory (source + data) — previously left behind entirely.
        opts.storageEngine?.destroyAddon(request.params.addonId);
        return reply.code(204).send();
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'ADDON_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NOT_FOUND',
            message: err.message ?? 'Addon not found',
          });
        }
        throw error;
      }
    },
  );

  // POST /api/addons/:addonId/enable - Enable addon with permissions
  app.post<{
    Params: { addonId: string };
    Body: EnableAddonBody;
    Reply: unknown;
  }>(
    '/api/addons/:addonId/enable',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const { approvedPermissions } = request.body;

        if (!Array.isArray(approvedPermissions)) {
          return reply.code(400).send({
            error: 'INVALID_REQUEST',
            message: 'approvedPermissions must be an array',
          });
        }

        const result = await addonService.enableAddon({
          addonId: request.params.addonId,
          approvedPermissions,
          approvedBy: 'admin',
        });

        return reply.send(result);
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'ADDON_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NOT_FOUND',
            message: err.message ?? 'Addon not found',
          });
        }
        if (err.code === 'INVALID_PERMISSIONS') {
          return reply.code(400).send({
            error: 'INVALID_PERMISSIONS',
            message: err.message ?? 'Invalid permissions',
          });
        }
        if (err.code === 'ADDON_NOT_DISABLED') {
          return reply.code(409).send({
            error: 'ALREADY_ENABLED',
            message: err.message ?? 'Addon is already enabled',
          });
        }
        throw error;
      }
    },
  );

  // POST /api/addons/:addonId/refresh-token - Re-issue an access token for an enabled addon
  app.post<{ Params: { addonId: string }; Reply: unknown }>(
    '/api/addons/:addonId/refresh-token',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const result = await addonService.refreshAddonToken(
          request.params.addonId,
        );
        return reply.send(result);
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'ADDON_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NOT_FOUND',
            message: err.message ?? 'Addon not found',
          });
        }
        if (err.code === 'ADDON_NOT_ENABLED') {
          return reply.code(409).send({
            error: 'NOT_ENABLED',
            message: err.message ?? 'Addon is not enabled',
          });
        }
        throw error;
      }
    },
  );

  // GET /api/addons/:addonId/asset-token - Mint a short-lived token the web
  // client puts on the iframe URL so the sandboxed addon (opaque origin, no
  // header/cookie possible) can authenticate its static asset loads.
  app.get<{ Params: { addonId: string } }>(
    '/api/addons/:addonId/asset-token',
    { preHandler: adminAuth },
    async (request, reply) => {
      const token = signAssetToken(
        request.params.addonId,
        opts.jwtSecret,
        ASSET_TOKEN_TTL_MS,
      );
      return reply.send({ token, expiresIn: ASSET_TOKEN_TTL_MS });
    },
  );

  /** Reject the request unless it carries a valid asset token. */
  const requireAssetToken = (
    request: FastifyRequest,
    reply: FastifyReply,
    addonId?: string,
  ): boolean => {
    const token = getAssetToken(request);
    if (
      !token ||
      !verifyAssetToken(token, opts.jwtSecret, addonId ? { addonId } : {})
    ) {
      reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid asset token',
      });
      return false;
    }
    return true;
  };

  // GET /sdk/openaidy-sdk.js - Serve the addon SDK (asset-token gated)
  app.get('/sdk/openaidy-sdk.js', async (request, reply) => {
    // SDK is shared across addons, so the token need not be addon-bound.
    if (!requireAssetToken(request, reply)) return reply;

    // OPENAIDY_SDK_PATH lets a packaged (bundled) install point at the SDK
    // shipped in the package; dev/source falls back to the co-located file.
    const sdkPath =
      process.env['OPENAIDY_SDK_PATH'] ??
      path.join(__dirname, '../sdk/openaidy-sdk.js');
    if (!fs.existsSync(sdkPath)) {
      return reply.code(404).send({ error: 'SDK not found' });
    }
    return reply
      .header('Content-Type', 'application/javascript')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(fs.readFileSync(sdkPath));
  });

  // GET /sdk/components.json - Serve the sdk.ui.* component manifest, parsed
  // from @component JSDoc blocks in openaidy-sdk.js. Not asset-token gated —
  // this is documentation, not a credential, same as GET /info. Cached after
  // the first parse: the SDK file doesn't change within a server's lifetime.
  let componentManifestCache: ComponentManifest | null = null;
  app.get('/sdk/components.json', async (_request, reply) => {
    if (!componentManifestCache) {
      const sdkPath =
        process.env['OPENAIDY_SDK_PATH'] ??
        path.join(__dirname, '../sdk/openaidy-sdk.js');
      if (!fs.existsSync(sdkPath)) {
        return reply.code(404).send({ error: 'SDK not found' });
      }
      componentManifestCache = parseComponentManifest(
        fs.readFileSync(sdkPath, 'utf-8'),
      );
    }
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(componentManifestCache);
  });

  // GET /addons/:addonId/* - Serve addon static files
  app.get<{ Params: { addonId: string; '*': string } }>(
    '/addons/:addonId/*',
    async (request, reply) => {
      const { addonId } = request.params;

      // Asset token must be present, valid, and bound to this addon.
      if (!requireAssetToken(request, reply, addonId)) return reply;

      const filePath = request.params['*'] || 'index.html';
      const addonsDir = path.join(env.OPENAIDY_HOME, 'addons');
      const fullPath = path.join(addonsDir, addonId, filePath);

      // Prevent path traversal
      const resolved = path.resolve(fullPath);
      const base = path.resolve(addonsDir);
      if (!resolved.startsWith(base)) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      if (!fs.existsSync(resolved)) {
        return reply
          .code(404)
          .send({ error: 'NOT_FOUND', message: `File not found: ${filePath}` });
      }

      const ext = path.extname(resolved).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      const contentType = mimeTypes[ext] ?? 'application/octet-stream';

      // Read externalDomains from the addon manifest to extend connect-src.
      // TODO: In the future, prompt the user to approve these domains before
      // the addon is enabled — similar to the permissions approval flow.
      const manifestPath = path.join(addonsDir, addonId, 'addon.json');
      let externalDomains: string[] = [];
      let externalImageDomains: string[] = [];
      try {
        const manifestRaw = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8'),
        ) as Record<string, unknown>;
        if (Array.isArray(manifestRaw['externalDomains'])) {
          externalDomains = (
            manifestRaw['externalDomains'] as unknown[]
          ).filter((d): d is string => typeof d === 'string');
        }
        if (Array.isArray(manifestRaw['externalImageDomains'])) {
          externalImageDomains = (
            manifestRaw['externalImageDomains'] as unknown[]
          ).filter((d): d is string => typeof d === 'string');
        }
      } catch {
        // manifest unreadable — proceed with no external domains
      }

      const normalizeHosts = (hosts: string[]) =>
        hosts
          .map((d) => d.replace(/^https?:\/\//i, '').split('/')[0] ?? '')
          .filter((d) => /^[a-zA-Z0-9.-]+(:\d+)?$/.test(d))
          .map((d) => `https://${d}`);

      const connectSrc = ["'self'", ...normalizeHosts(externalDomains)].join(
        ' ',
      );
      const imgSrc = [
        "'self'",
        'data:',
        ...normalizeHosts(externalImageDomains),
      ].join(' ');

      // The addon HTML is loaded inside a sandboxed iframe WITHOUT
      // allow-same-origin, which gives the document an opaque origin.
      // CSP 'self' does NOT match any URL against an opaque origin, so
      // script-src 'self' silently blocks every <script> tag.  We must
      // use the actual request origin (scheme + host + port) instead.
      // `request.headers.host` reflects the browser-facing origin — in
      // dev mode it's "localhost:5173" (Vite proxy), in production it's
      // whatever the client actually hits.  We also include the backend
      // direct origin as a fallback.
      const requestHost = request.headers.host;
      const scriptSrcOrigins = [
        "'unsafe-inline'",
        ...(requestHost ? [`http://${requestHost}`] : []),
        `http://localhost:${env.PORT}`,
        TAILWIND_CDN_ORIGIN,
      ];
      const scriptSrc = scriptSrcOrigins.join(' ');

      const csp = [
        "default-src 'none'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        `img-src ${imgSrc}`,
        "font-src 'self'",
        `connect-src ${connectSrc}`,
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');

      // The addon iframe is sandboxed WITHOUT `allow-same-origin`, so its
      // document has an opaque origin and EVERY subresource request counts
      // as cross-site. A classic `<script src>` tag is fetched in `no-cors`
      // mode by default, and strict dev servers reject cross-origin no-cors
      // script loads with 403 (Vite's rejectNoCorsRequestMiddleware —
      // GHSA-4v9v-hfq4-rm2v). To let the addon's scripts (and the SDK) load,
      // we rewrite `<script src>` tags to request in CORS mode by adding
      // `crossorigin="anonymous"`. The responses already carry
      // `Access-Control-Allow-Origin: *`, so the CORS check passes. This is
      // a no-op in production (the static handler still sends ACAO: *).
      let payload: string | Buffer = fs.readFileSync(resolved);
      if (ext === '.html') {
        // Propagate the (validated) asset token onto every local subresource
        // URL so the iframe's scripts/styles/SDK authenticate too.
        const token = getAssetToken(request) ?? '';
        payload = rewriteAddonHtml(payload.toString('utf-8'), token);
      }

      return reply
        .header('Content-Type', contentType)
        .header('Access-Control-Allow-Origin', '*')
        .header('Content-Security-Policy', csp)
        .send(payload);
    },
  );

  // POST /api/addons/:addonId/disable - Disable addon
  app.post<{
    Params: { addonId: string };
    Reply: unknown;
  }>(
    '/api/addons/:addonId/disable',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const addon = await addonService.disableAddon({
          addonId: request.params.addonId,
          disabledBy: 'admin',
        });

        return reply.send({ addon });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'ADDON_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NOT_FOUND',
            message: err.message ?? 'Addon not found',
          });
        }
        if (err.code === 'ADDON_NOT_DISABLED') {
          return reply.code(409).send({
            error: 'ALREADY_DISABLED',
            message: err.message ?? 'Addon is already disabled',
          });
        }
        throw error;
      }
    },
  );
};
