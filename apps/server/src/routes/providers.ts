import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createProviderRegistry,
  createProviderSelection,
  createModelInvocation,
  type ProviderRegistryService,
  type RegisteredProvider,
} from '../providers';
import type { Message, ModelRequest } from '@openaidy/runtime';

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
    ])
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
 * Provider Routes Plugin
 * 
 * Provides internal API routes for provider invocation testing and diagnostics.
 */
export const providerRoutes: FastifyPluginAsync = async (app) => {
  // Initialize provider services
  const registry = createProviderRegistry();
  const selection = createProviderSelection(registry);
  const invocation = createModelInvocation(registry, selection);

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
    const filtered = enabled !== undefined
      ? entries.filter((e) => e.enabled === enabled)
      : entries;

    // Map to response format
    const providers: ProviderInfo[] = filtered.map((entry) => {
      const descriptor = entry.provider.descriptor;
      return {
        id: descriptor.id,
        name: descriptor.name,
        ...(descriptor.description !== undefined && { description: descriptor.description }),
        capabilities: descriptor.capabilities,
        vendorFamily: descriptor.vendorFamily,
        enabled: entry.enabled,
        ...(entry.defaultModel !== undefined && { defaultModel: entry.defaultModel }),
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
        status: isAvailable ? 'available' as const : 'unavailable' as const,
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
  app.post('/providers/test-invoke', async (request, reply): Promise<TestInvokeResponse> => {
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
          message: error instanceof Error ? error.message : 'Invalid request body',
          retryable: false,
        },
      };
    }
    const { providerId, modelId, messages, maxTokens, temperature, stream } = body;

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
          ...(result.error.providerId !== undefined && { providerId: result.error.providerId }),
          ...(result.error.modelId !== undefined && { modelId: result.error.modelId }),
        },
      };
    }
  });

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
      message: 'Provider registration must be done programmatically at server startup',
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
      ...(descriptor.description !== undefined && { description: descriptor.description }),
      capabilities: descriptor.capabilities,
      vendorFamily: descriptor.vendorFamily,
      enabled: entry.enabled,
      priority: entry.priority,
      ...(entry.defaultModel !== undefined && { defaultModel: entry.defaultModel }),
      ...(entry.config !== undefined && { config: entry.config }),
      registeredAt: entry.registeredAt.toISOString(),
    };
  });
};

/**
 * Helper to get all registry entries
 */
function getAllEntries(
  registry: ProviderRegistryService
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

/**
 * Export services for external use (e.g., registering providers at startup)
 */
export function getProviderServices() {
  const registry = createProviderRegistry();
  const selection = createProviderSelection(registry);
  const invocation = createModelInvocation(registry, selection);

  return {
    registry,
    selection,
    invocation,
  };
}
