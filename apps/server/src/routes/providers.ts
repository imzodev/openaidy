import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import {
  type ProviderServices,
  type ProviderRegistryService,
  type RegisteredProvider,
  ProviderConnectionService,
} from '../providers';
import {
  exchangeMiniMaxCode,
  startMiniMaxOAuth,
  type MiniMaxRegion,
} from '../providers/oauth/minimax';
import { DbOAuthStateStore } from '../providers/oauth/state-store';
import { env } from '../lib/env.js';
import type { Message, ModelRequest } from '@openaidy/runtime';
import type { DatabaseClient } from '@openaidy/db';
import type {
  ProviderInfo as ConnectionProviderInfo,
  ConnectProviderResponse,
} from '@openaidy/shared-types';

/**
 * Schema for test-invoke request
 */
const testInvokeSchema = z.object({
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  messages: z.array(
    z.union([
      z.object({
        role: z.literal('system'),
        content: z.string(),
      }),
      z.object({
        role: z.literal('user'),
        content: z.string(),
      }),
      z.object({
        role: z.literal('assistant'),
        content: z.string(),
      }),
      z.object({
        role: z.literal('tool'),
        content: z.string(),
        toolCallId: z.string(),
      }),
    ]),
  ),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

/**
 * Schema for provider query parameters
 */
const providersQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
});

/**
 * Provider routes response types
 */
type ProviderInfo = {
  id: string;
  name: string;
  description?: string;
  capabilities: readonly string[];
  vendorFamily: string;
  enabled: boolean;
  defaultModel?: string;
  priority: number;
};

type ProvidersListResponse = {
  providers: ProviderInfo[];
  default?: {
    providerId: string;
    modelId: string;
  };
};

type ProviderHealthResponse = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  providers: {
    id: string;
    name: string;
    enabled: boolean;
    status: 'available' | 'unavailable';
  }[];
  timestamp: string;
};

type TestInvokeResponse = {
  ok: boolean;
  response?: {
    id: string;
    model: string;
    providerId: string;
    content: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    finishReason: string;
    created: string;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    providerId?: string;
    modelId?: string;
  };
};

/**
 * Options for provider routes plugin
 */
type ProviderRoutesOptions = {
  services: ProviderServices;
  authMiddleware: AuthMiddleware;
  db?: DatabaseClient;
};

/**
 * Provider Routes Plugin
 *
 * Provides internal API routes for provider invocation testing and diagnostics.
 *
 * IMPORTANT: This plugin receives provider services via options rather than
 * creating its own instances. This ensures all routes operate on the same
 * service graph used by the rest of the application.
 */
export const providerRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (
  app,
  options,
) => {
  // Use injected services from app initialization
  const { services, authMiddleware, db } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'providers.read' }),
  );
  const { registry, invocation } = services;

  // Create connection service only if database is available
  const connectionService = db ? new ProviderConnectionService(db) : null;
  // Selection is available via services.selection if needed for future routes

  // OAuth state store — same DB in dev and prod. Required for the
  // MiniMax OAuth flow (state → PKCE verifier between /start and /callback).
  const oauthStateStore = db ? new DbOAuthStateStore(db) : null;

  // The frontend URL the popup window should redirect to after a
  // successful/failed OAuth exchange. Pulled from CORS_ORIGIN (which
  // is the frontend's dev server URL) or defaults to localhost:5173.
  // (Unused for MiniMax — the callback returns HTML directly — but kept
  // for providers that may need it in future phases.)
  const _frontendBaseUrl = env.CORS_ORIGIN || 'http://localhost:5173';

  /**
   * GET /providers
   * List all registered providers with their descriptors and status
   */
  app.get('/providers', async (request): Promise<ProvidersListResponse> => {
    const query = providersQuerySchema.parse(request.query);
    const { enabled } = query;

    // Get all provider entries
    const entries = getAllEntries(registry);

    // Filter by enabled status if specified
    const filtered =
      enabled !== undefined
        ? entries.filter((e) => e.enabled === enabled)
        : entries;

    // Map to response format
    const providers: ProviderInfo[] = filtered.map((entry) => {
      const descriptor = entry.provider.descriptor;
      return {
        id: descriptor.id,
        name: descriptor.name,
        ...(descriptor.description !== undefined && {
          description: descriptor.description,
        }),
        capabilities: descriptor.capabilities,
        vendorFamily: descriptor.vendorFamily,
        enabled: entry.enabled,
        ...(entry.defaultModel !== undefined && {
          defaultModel: entry.defaultModel,
        }),
        priority: entry.priority,
      };
    });

    // Get default config if available
    const defaultConfig = registry.getDefault();

    return {
      providers,
      ...(defaultConfig && { default: defaultConfig }),
    };
  });

  /**
   * GET /providers/health
   * Check health status of all providers
   */
  app.get('/providers/health', async (): Promise<ProviderHealthResponse> => {
    const entries = getAllEntries(registry);

    // Determine overall status
    let healthyCount = 0;
    let unhealthyCount = 0;

    const providerStatuses = entries.map((entry) => {
      const isAvailable = entry.enabled;
      if (isAvailable) {
        healthyCount++;
      } else {
        unhealthyCount++;
      }

      const descriptor = entry.provider.descriptor;
      return {
        id: descriptor.id,
        name: descriptor.name,
        enabled: entry.enabled,
        status: isAvailable ? ('available' as const) : ('unavailable' as const),
      };
    });

    // Determine overall health status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (entries.length === 0) {
      status = 'unhealthy';
    } else if (unhealthyCount === 0) {
      status = 'healthy';
    } else if (healthyCount > 0) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      providers: providerStatuses,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * POST /providers/test-invoke
   * Test provider invocation through the application layer
   */
  app.post(
    '/providers/test-invoke',
    async (request, reply): Promise<TestInvokeResponse> => {
      // Validate request body with Zod
      let body;
      try {
        body = testInvokeSchema.parse(request.body);
      } catch (error) {
        reply.code(400);
        return {
          ok: false,
          error: {
            code: 'provider.invalid_request',
            message:
              error instanceof Error ? error.message : 'Invalid request body',
            retryable: false,
          },
        };
      }
      const { providerId, modelId, messages, maxTokens, temperature, stream } =
        body;

      // Build the model request with proper Message type
      const modelRequest: ModelRequest = {
        model: modelId ?? 'default',
        messages: messages.map((m): Message => {
          if (m.role === 'tool') {
            return {
              role: 'tool',
              toolCallId: m.toolCallId,
              content: m.content,
            };
          }
          return {
            role: m.role,
            content: m.content,
          } as Message;
        }),
        ...(maxTokens !== undefined && { maxTokens }),
        ...(temperature !== undefined && { temperature }),
        ...(stream !== undefined && { stream }),
      };

      // Invoke through the model invocation service
      const result = await invocation.invoke(modelRequest, {
        ...(providerId !== undefined && { providerId }),
        ...(modelId !== undefined && { modelId }),
      });

      if (result.ok) {
        reply.code(200);
        return {
          ok: true,
          response: {
            id: result.value.id,
            model: result.value.model,
            providerId: result.value.providerId,
            content: result.value.content,
            usage: {
              promptTokens: result.value.usage.promptTokens,
              completionTokens: result.value.usage.completionTokens,
              totalTokens: result.value.usage.totalTokens,
            },
            finishReason: result.value.finishReason,
            created: result.value.created,
          },
        };
      } else {
        // Return normalized error
        reply.code(400);
        return {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            retryable: result.error.retryable,
            ...(result.error.providerId !== undefined && {
              providerId: result.error.providerId,
            }),
            ...(result.error.modelId !== undefined && {
              modelId: result.error.modelId,
            }),
          },
        };
      }
    },
  );

  /**
   * POST /providers/register
   * Register a new provider (for testing purposes)
   */
  app.post('/providers/register', async (request, reply) => {
    // This endpoint is for testing purposes
    // In production, providers would be registered at startup
    reply.code(501);
    return {
      error: 'Not implemented',
      message:
        'Provider registration must be done programmatically at server startup',
    };
  });

  /**
   * POST /providers/:providerId/enable
   * Enable a provider
   */
  app.post('/providers/:providerId/enable', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    if (!registry.has(providerId)) {
      reply.code(404);
      return {
        error: 'Provider not found',
        providerId,
      };
    }

    const success = registry.enable(providerId);
    reply.code(200);
    return {
      success,
      providerId,
      enabled: registry.isEnabled(providerId),
    };
  });

  /**
   * POST /providers/:providerId/disable
   * Disable a provider
   */
  app.post('/providers/:providerId/disable', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    if (!registry.has(providerId)) {
      reply.code(404);
      return {
        error: 'Provider not found',
        providerId,
      };
    }

    const success = registry.disable(providerId);
    reply.code(200);
    return {
      success,
      providerId,
      enabled: registry.isEnabled(providerId),
    };
  });

  /**
   * GET /providers/:providerId
   * Get details for a specific provider
   */
  app.get('/providers/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const entry = registry.getEntry(providerId);

    if (!entry) {
      reply.code(404);
      return {
        error: 'Provider not found',
        providerId,
      };
    }

    const descriptor = entry.provider.descriptor;
    return {
      id: descriptor.id,
      name: descriptor.name,
      ...(descriptor.description !== undefined && {
        description: descriptor.description,
      }),
      capabilities: descriptor.capabilities,
      vendorFamily: descriptor.vendorFamily,
      enabled: entry.enabled,
      priority: entry.priority,
      ...(entry.defaultModel !== undefined && {
        defaultModel: entry.defaultModel,
      }),
      ...(entry.config !== undefined && { config: entry.config }),
      registeredAt: entry.registeredAt.toISOString(),
    };
  });

  // =========================================================================
  // Provider Connection Routes (only if database is available)
  // =========================================================================

  if (!connectionService) {
    // Database not available - skip connection routes
    return;
  }

  /**
   * GET /providers/connection
   * List available providers with their connection status
   */
  app.get(
    '/providers/connection',
    async (): Promise<{
      providers: ConnectionProviderInfo[];
    }> => {
      const providers = connectionService.listAvailableProviders();
      return { providers };
    },
  );

  /**
   * GET /providers/:providerId/auth-methods
   * Get available authentication methods for a provider
   */
  app.get('/providers/:providerId/auth-methods', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    try {
      const authMethods = connectionService.getAuthMethods(providerId);
      return { providerId, authMethods };
    } catch (_error) {
      reply.code(404);
      return {
        error: 'Provider not found',
        providerId,
      };
    }
  });

  /**
   * POST /providers/:providerId/connect/api-key
   * Connect a provider using an API key
   */
  app.post(
    '/providers/:providerId/connect/api-key',
    async (request, reply): Promise<ConnectProviderResponse> => {
      const { providerId } = request.params as { providerId: string };

      const bodySchema = z.object({
        apiKey: z.string().min(1, 'API key is required'),
      });

      let body;
      try {
        body = bodySchema.parse(request.body);
      } catch (error) {
        reply.code(400);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Invalid request body',
        };
      }

      const result = await connectionService.connectWithApiKey(
        providerId,
        body.apiKey,
      );

      if (!result.success) {
        reply.code(400);
      }

      return result;
    },
  );

  /**
   * POST /providers/minimax/connect/oauth/start
   *
   * Real MiniMax OAuth flow (PKCE, no client_id/secret).
   * Returns the authorization URL the user should be redirected to.
   *
   * For web: the frontend opens this URL in a popup.
   * For CLI: the CLI prints this URL and asks the user to open it.
   */
  if (oauthStateStore) {
    app.post(
      '/providers/minimax/connect/oauth/start',
      async (request, reply) => {
        const bodySchema = z.object({
          region: z.enum(['global', 'cn']).default('global'),
          redirectUri: z.string().url('Valid redirect URI is required'),
        });

        const parseResult = bodySchema.safeParse(request.body);
        if (!parseResult.success) {
          reply.code(400);
          return {
            success: false,
            error: parseResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
          };
        }

        const { region, redirectUri } = parseResult.data;

        try {
          const result = await startMiniMaxOAuth({
            stateStore: oauthStateStore,
            region: region as MiniMaxRegion,
            redirectUri,
          });
          return { success: true, ...result };
        } catch (err) {
          reply.code(500);
          return {
            success: false,
            error:
              err instanceof Error
                ? err.message
                : 'Failed to start MiniMax OAuth flow',
          };
        }
      },
    );

    /**
     * GET /providers/minimax/connect/oauth/callback
     *
     * Receives the redirect from MiniMax after the user authorizes.
     * Exchanges the code for tokens, persists them, then returns a
     * tiny HTML page that posts a message to window.opener and
     * closes itself. The parent window (the dialog) listens for
     * that message and updates its state.
     *
     * Returning HTML directly (instead of a redirect to the front)
     * means the popup is self-contained — Vite proxy / CORS issues
     * don't matter. The popup and the dialog share `window.opener`.
     */
    app.get(
      '/providers/minimax/connect/oauth/callback',
      async (request, reply) => {
        const query = request.query as {
          code?: string;
          state?: string;
          error?: string;
          error_description?: string;
        };

        let status: 'ok' | 'error' = 'ok';
        let reason: string | undefined;

        if (query.error) {
          status = 'error';
          reason = query.error_description ?? query.error;
        } else if (!query.code || !query.state) {
          status = 'error';
          reason = 'missing_code_or_state';
        } else {
          const result = await exchangeMiniMaxCode({
            stateStore: oauthStateStore,
            state: query.state,
            code: query.code,
            db,
          });
          if (!result.success) {
            status = 'error';
            reason = result.error;
          }
        }

        // Self-contained HTML. Sets opener.postMessage then window.close.
        // The dialog listens for this message and updates the UI.
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MiniMax Authorization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 32px 48px; border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.1); text-align: center; }
    h1 { margin: 0 0 8px; font-size: 18px; color: #111; }
    p { margin: 0; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${status === 'ok' ? 'Connected to MiniMax' : 'Authorization Failed'}</h1>
    <p>This window will close automatically.</p>
  </div>
  <script>
    (function() {
      var payload = {
        type: 'oauth:complete',
        provider: 'minimax',
        status: ${JSON.stringify(status)},
        ${reason ? `reason: ${JSON.stringify(reason)},` : ''}
      };
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {
        // opener may be gone (popup blocker, etc.)
        console.error('postMessage failed', e);
      }
      // Close the popup after a short delay so the user sees the
      // confirmation briefly.
      setTimeout(function() { window.close(); }, 300);
    })();
  </script>
</body>
</html>`;

        reply.code(200).type('text/html; charset=utf-8').send(html);
      },
    );
  }

  /**
   * POST /providers/:providerId/connect/oauth/start
   * Start OAuth flow for a provider
   */
  app.post(
    '/providers/:providerId/connect/oauth/start',
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };

      const bodySchema = z.object({
        redirectUri: z.string().url('Valid redirect URI is required'),
      });

      let body;
      try {
        body = bodySchema.parse(request.body);
      } catch (error) {
        reply.code(400);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Invalid request body',
        };
      }

      try {
        const result = await connectionService.startOAuthFlow(
          providerId,
          body.redirectUri,
        );
        return result;
      } catch (error) {
        reply.code(400);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to start OAuth flow',
        };
      }
    },
  );

  /**
   * GET /providers/:providerId/connect/oauth/callback
   * OAuth callback handler (redirect-based)
   */
  app.get(
    '/providers/:providerId/connect/oauth/callback',
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (query.error) {
        reply.code(400);
        return {
          success: false,
          providerId,
          error: query.error,
        };
      }

      if (!query.code) {
        reply.code(400);
        return {
          success: false,
          providerId,
          error: 'Authorization code missing',
        };
      }

      const result = await connectionService.completeOAuthFlow(
        providerId,
        query.code,
        '', // redirectUri not available in GET request
      );

      if (!result.success) {
        reply.code(400);
      }

      return result;
    },
  );

  /**
   * POST /providers/:providerId/connect/device-code/start
   * Start device code flow for CLI/Desktop apps
   */
  app.post(
    '/providers/:providerId/connect/device-code/start',
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };

      try {
        const result = await connectionService.startDeviceCodeFlow(providerId);
        return result;
      } catch (error) {
        reply.code(400);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to start device code flow',
        };
      }
    },
  );

  /**
   * POST /providers/:providerId/connect/device-code/poll
   * Poll for device code authorization completion
   */
  app.post(
    '/providers/:providerId/connect/device-code/poll',
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };

      const bodySchema = z.object({
        deviceCode: z.string().min(1, 'Device code is required'),
      });

      let body;
      try {
        body = bodySchema.parse(request.body);
      } catch (error) {
        reply.code(400);
        return {
          error:
            error instanceof Error ? error.message : 'Invalid request body',
        };
      }

      const result = await connectionService.pollDeviceCodeAuth(
        providerId,
        body.deviceCode,
      );

      if (result.error) {
        reply.code(400);
      }

      return result;
    },
  );

  /**
   * DELETE /providers/:providerId/connection
   * Disconnect a provider
   */
  app.delete('/providers/:providerId/connection', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    const success = await connectionService.disconnect(providerId);

    if (!success) {
      reply.code(404);
      return {
        success: false,
        error: 'Provider not connected',
        providerId,
      };
    }

    return {
      success: true,
      providerId,
    };
  });
};

/**
 * Helper to get all registry entries
 */
function getAllEntries(
  registry: ProviderRegistryService,
): RegisteredProvider[] {
  // Use listAllDescriptors to get all provider IDs, then get entries
  const descriptors = registry.listAllDescriptors();
  const entries: RegisteredProvider[] = [];

  for (const descriptor of descriptors) {
    const entry = registry.getEntry(descriptor.id);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}
