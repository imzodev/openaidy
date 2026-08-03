import {
  createProviderError,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ProviderResult,
  err,
} from '@openaidy/runtime';
import type { ProviderRegistryService } from './registry';
import type { ProviderSelectionService } from './selection';
import { repairProviderHistory } from './history-repair.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('provider-invocation');

/**
 * Repair tool-call/tool-result adjacency in the request history before it
 * reaches the provider — see `history-repair.ts` for why a persisted
 * transcript can develop this shape and what "repair" means here. Applied
 * once, at this chokepoint, so every caller of `invoke`/`invokeStream`
 * (session submissions, the agentic dispatch loop, the planning service,
 * personality auto-fill, the provider test endpoint) is covered without
 * each one having to remember to call it.
 */
function repairRequestHistory(request: ModelRequest): ModelRequest {
  const { messages, diagnostics } = repairProviderHistory(request.messages);
  if (
    diagnostics.orphanToolResults > 0 ||
    diagnostics.strippedToolCallTurns > 0 ||
    diagnostics.deferredUserMessages > 0
  ) {
    log.warn('Repaired provider request history before sending', diagnostics);
  }
  return { ...request, messages };
}

/**
 * Invocation options
 */
export type InvocationOptions = {
  /** Override provider ID */
  providerId?: string;
  /** Override model ID */
  modelId?: string;
  /** Request metadata */
  metadata?: Record<string, unknown>;
};

/**
 * Model Invocation Service
 *
 * Orchestrates provider invocation through the normalized interface.
 * Handles both streaming and non-streaming paths.
 */
export class ModelInvocationService {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly selection: ProviderSelectionService,
  ) {}

  /**
   * Invoke a model (non-streaming)
   */
  async invoke(
    request: ModelRequest,
    options?: InvocationOptions,
  ): Promise<ProviderResult<ModelResponse>> {
    // Determine provider ID from options or request metadata
    const providerId =
      options?.providerId ??
      (request.metadata?.providerId as string | undefined);

    // Select provider and model
    const selectionResult = this.selection.select({
      ...(providerId !== undefined && { providerId }),
      modelId: options?.modelId ?? request.model,
      capabilities: request.stream
        ? ['streaming', 'text_generation']
        : ['text_generation'],
    });

    if (!selectionResult.ok) {
      return err(selectionResult.error);
    }

    const { provider, modelId } = selectionResult;

    // Check streaming capability if requested
    if (request.stream && !provider.hasCapability('streaming')) {
      return err(
        createProviderError(
          'provider.capability_unsupported',
          `Provider "${provider.descriptor.id}" does not support streaming`,
          { providerId: provider.descriptor.id, modelId },
        ),
      );
    }

    // Build the actual request with resolved model and repaired history
    const actualRequest: ModelRequest = {
      ...repairRequestHistory(request),
      model: modelId,
      metadata: {
        ...request.metadata,
        ...options?.metadata,
      },
    };

    try {
      // Invoke through the provider adapter
      const result = await provider.invoke(actualRequest);
      return result;
    } catch (error) {
      // Normalize unexpected errors
      return err(
        createProviderError(
          'provider.unknown',
          error instanceof Error ? error.message : 'Unknown invocation error',
          {
            cause: error,
            providerId: provider.descriptor.id,
            modelId,
          },
        ),
      );
    }
  }

  /**
   * Invoke a model (streaming)
   * Returns an async iterable of stream events
   */
  async *invokeStream(
    request: ModelRequest,
    options?: InvocationOptions,
  ): AsyncIterable<ProviderResult<ModelStreamEvent>> {
    // Determine provider ID from options or request metadata
    const providerId =
      options?.providerId ??
      (request.metadata?.providerId as string | undefined);

    // Select provider and model
    const selectionResult = this.selection.select({
      ...(providerId !== undefined && { providerId }),
      modelId: options?.modelId ?? request.model,
      capabilities: ['streaming', 'text_generation'],
    });

    if (!selectionResult.ok) {
      yield err(selectionResult.error);
      return;
    }

    const { provider, modelId } = selectionResult;

    // Check streaming capability
    if (!provider.hasCapability('streaming')) {
      yield err(
        createProviderError(
          'provider.capability_unsupported',
          `Provider "${provider.descriptor.id}" does not support streaming`,
          { providerId: provider.descriptor.id, modelId },
        ),
      );
      return;
    }

    // Build the actual request with resolved model and repaired history
    const actualRequest: ModelRequest = {
      ...repairRequestHistory(request),
      model: modelId,
      stream: true,
      metadata: {
        ...request.metadata,
        ...options?.metadata,
      },
    };

    try {
      // Stream through the provider adapter
      yield* provider.invokeStream(actualRequest);
    } catch (error) {
      // Yield normalized error for unexpected failures
      yield err(
        createProviderError(
          'provider.stream_error',
          error instanceof Error ? error.message : 'Unknown stream error',
          {
            cause: error,
            providerId: provider.descriptor.id,
            modelId,
          },
        ),
      );
    }
  }

  /**
   * Get the registry instance
   */
  getRegistry(): ProviderRegistryService {
    return this.registry;
  }

  /**
   * Get the selection service instance
   */
  getSelection(): ProviderSelectionService {
    return this.selection;
  }
}

/**
 * Create a model invocation service
 */
export function createModelInvocation(
  registry: ProviderRegistryService,
  selection: ProviderSelectionService,
): ModelInvocationService {
  return new ModelInvocationService(registry, selection);
}
