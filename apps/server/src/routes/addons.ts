import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../lib/env';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import { createAddonService } from '../addons/service';
import type { AddonsRepository } from '@openaidy/db';
import type { ManifestValidator } from '../addons/manifest-validator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_SCOPE = '*';

/**
 * Addon routes options
 */
export type AddonRoutesOptions = {
  addonsRepository: AddonsRepository;
  authMiddleware: AuthMiddleware;
  jwtSecret: string;
  openAidyVersion: string;
  manifestValidator: ManifestValidator;
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

  // GET /api/addons/:id - Get addon details
  app.get<{
    Params: { id: string };
    Reply: unknown;
  }>('/api/addons/:id', { preHandler: adminAuth }, async (request, reply) => {
    const addon = await addonService.getAddon(request.params.id);

    if (!addon) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Addon not found',
      });
    }

    return reply.send({ addon });
  });

  // PUT /api/addons/:id - Update addon configuration
  app.put<{
    Params: { id: string };
    Body: UpdateConfigBody;
    Reply: unknown;
  }>('/api/addons/:id', { preHandler: adminAuth }, async (request, reply) => {
    try {
      const addon = await addonService.updateAddonConfig({
        addonId: request.params.id,
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
  });

  // DELETE /api/addons/:id - Uninstall addon
  app.delete<{
    Params: { id: string };
    Reply: void | ErrorResponse;
  }>('/api/addons/:id', { preHandler: adminAuth }, async (request, reply) => {
    try {
      await addonService.uninstallAddon(request.params.id, 'admin');
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
  });

  // POST /api/addons/:id/enable - Enable addon with permissions
  app.post<{
    Params: { id: string };
    Body: EnableAddonBody;
    Reply: unknown;
  }>(
    '/api/addons/:id/enable',
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
          addonId: request.params.id,
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

  // GET /sdk/openaidy-sdk.js - Serve the addon SDK
  app.get('/sdk/openaidy-sdk.js', async (_request, reply) => {
    const sdkPath = path.join(__dirname, '../sdk/openaidy-sdk.js');
    if (!fs.existsSync(sdkPath)) {
      return reply.code(404).send({ error: 'SDK not found' });
    }
    return reply
      .header('Content-Type', 'application/javascript')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(fs.readFileSync(sdkPath));
  });

  // GET /addons/:addonId/* - Serve addon static files from dist/
  app.get<{ Params: { addonId: string; '*': string } }>(
    '/addons/:addonId/*',
    async (request, reply) => {
      const { addonId } = request.params;
      const filePath = request.params['*'] || 'index.html';
      const addonsDir = path.join(env.OPENAIDY_HOME, 'addons');
      const fullPath = path.join(addonsDir, addonId, 'dist', filePath);

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
      return reply
        .header('Content-Type', contentType)
        .header('Access-Control-Allow-Origin', '*')
        .send(fs.readFileSync(resolved));
    },
  );

  // POST /api/addons/:id/disable - Disable addon
  app.post<{
    Params: { id: string };
    Reply: unknown;
  }>(
    '/api/addons/:id/disable',
    { preHandler: adminAuth },
    async (request, reply) => {
      try {
        const addon = await addonService.disableAddon({
          addonId: request.params.id,
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
