import type {
  ModelProvider,
  ProviderDescriptor,
  ModelDescriptor,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ProviderCapability,
  ProviderResult,
} from '../provider';
import { ok, err } from '../provider';
import { createProviderError } from '../errors';

/**
 * Options for creating a fake provider
 */
export type FakeProviderOptions = {
  /** Provider ID */
  id?: string;
  /** Provider name */
  name?: string;
  /** Provider description */
  description?: string;
  /** Supported capabilities */
  capabilities?: readonly ProviderCapability[];
  /** Vendor family */
  vendorFamily?: string;
  /** Whether to simulate errors */
  simulateErrors?: boolean;
  /** Error to simulate */
  errorToSimulate?: 'auth' | 'rate_limit' | 'timeout' | 'unavailable' | 'generic';
  /** Response content */
  responseContent?: string;
  /** Stream content chunks */
  streamChunks?: string[];
  /** Delay between stream chunks (ms) */
  streamDelay?: number;
  /** Available models */
  models?: readonly ModelDescriptor[];
};

/**
 * Default models for the fake provider
 */
const DEFAULT_MODELS: readonly ModelDescriptor[] = [
  {
    id: 'fake-model',
    providerId: 'fake-provider',
    name: 'Fake Model',
    description: 'A fake model for testing',
    capabilities: ['text_generation', 'streaming'],
    contextWindow: 4096,
    maxOutputTokens: 2048,
  },
  {
    id: 'fake-model-vision',
    providerId: 'fake-provider',
    name: 'Fake Model with Vision',
    description: 'A fake model with vision support',
    capabilities: ['text_generation', 'streaming', 'vision'],
    contextWindow: 8192,
    maxOutputTokens: 4096,
  },
];

/**
 * Creates a fake provider for testing purposes
 */
export function createFakeProvider(options: FakeProviderOptions = {}): ModelProvider {
  const {
    id = 'fake-provider',
    name = 'Fake Provider',
    description = 'A fake provider for testing',
    capabilities = ['text_generation', 'streaming', 'tool_calls'],
    vendorFamily = 'fake',
    simulateErrors = false,
    errorToSimulate = 'generic',
    responseContent = 'This is a fake response from the fake provider.',
    streamChunks = ['Hello', ' ', 'world', '!'],
    streamDelay = 0,
    models = DEFAULT_MODELS,
  } = options;

  const descriptor: ProviderDescriptor = {
    id,
    name,
    description,
    capabilities,
    vendorFamily,
  };

  const provider: ModelProvider = {
    descriptor,

    listModels: async (): Promise<ProviderResult<readonly ModelDescriptor[]>> => {
      if (simulateErrors && errorToSimulate === 'auth') {
        return err(
          createProviderError('provider.auth.invalid', 'Invalid authentication', {
            providerId: id,
          })
        );
      }
      return ok(models);
    },

    getModel: async (modelId: string): Promise<ProviderResult<ModelDescriptor>> => {
      if (simulateErrors && errorToSimulate === 'auth') {
        return err(
          createProviderError('provider.auth.invalid', 'Invalid authentication', {
            providerId: id,
          })
        );
      }
      const model = models.find((m) => m.id === modelId);
      if (model) {
        return ok(model);
      }
      return err(
        createProviderError('provider.model_not_found', `Model "${modelId}" not found`, {
          providerId: id,
          modelId,
        })
      );
    },

    hasCapability: (capability: ProviderCapability): boolean => {
      return capabilities.includes(capability);
    },

    invoke: async (request: ModelRequest): Promise<ProviderResult<ModelResponse>> => {
      // Simulate errors if requested
      if (simulateErrors) {
        switch (errorToSimulate) {
          case 'auth':
            return err(
              createProviderError('provider.auth.invalid', 'Invalid API key', {
                providerId: id,
                modelId: request.model,
              })
            );
          case 'rate_limit':
            return err(
              createProviderError('provider.rate_limited', 'Rate limit exceeded', {
                providerId: id,
                modelId: request.model,
                retryAfterMs: 60000,
              })
            );
          case 'timeout':
            return err(
              createProviderError('provider.timeout', 'Request timed out', {
                providerId: id,
                modelId: request.model,
              })
            );
          case 'unavailable':
            return err(
              createProviderError('provider.unavailable', 'Provider is unavailable', {
                providerId: id,
                modelId: request.model,
              })
            );
          case 'generic':
          default:
            return err(
              createProviderError('provider.unknown', 'An unknown error occurred', {
                providerId: id,
                modelId: request.model,
              })
            );
        }
      }

      // Check if model exists
      const model = models.find((m) => m.id === request.model);
      if (!model) {
        return err(
          createProviderError('provider.model_not_found', `Model "${request.model}" not found`, {
            providerId: id,
            modelId: request.model,
          })
        );
      }

      // Check if streaming capability is required but not supported
      if (request.stream && !capabilities.includes('streaming')) {
        return err(
          createProviderError(
            'provider.capability_unsupported',
            'Streaming is not supported by this provider',
            { providerId: id, modelId: request.model }
          )
        );
      }

      // Check if tool calls capability is required but not supported
      if (request.tools && request.tools.length > 0 && !capabilities.includes('tool_calls')) {
        return err(
          createProviderError(
            'provider.capability_unsupported',
            'Tool calls are not supported by this provider',
            { providerId: id, modelId: request.model }
          )
        );
      }

      // Return successful response
      return ok({
        id: `resp_${Date.now()}`,
        model: request.model,
        providerId: id,
        content: responseContent,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        finishReason: 'stop',
        created: new Date().toISOString(),
      });
    },

    invokeStream: async function* (
      request: ModelRequest
    ): AsyncIterable<ProviderResult<ModelStreamEvent>> {
      const streamId = `stream_${Date.now()}`;
      const timestamp = new Date().toISOString();

      // Check if streaming is supported
      if (!capabilities.includes('streaming')) {
        yield err(
          createProviderError(
            'provider.capability_unsupported',
            'Streaming is not supported by this provider',
            { providerId: id, modelId: request.model }
          )
        );
        return;
      }

      // Simulate errors if requested
      if (simulateErrors) {
        // Yield stream started event first
        yield ok({
          type: 'stream.started' as const,
          timestamp,
          id: streamId,
          model: request.model,
          providerId: id,
        });

        // Then yield error
        switch (errorToSimulate) {
          case 'auth':
            yield err(
              createProviderError('provider.auth.invalid', 'Invalid API key', {
                providerId: id,
                modelId: request.model,
              })
            );
            return;
          case 'rate_limit':
            yield err(
              createProviderError('provider.rate_limited', 'Rate limit exceeded', {
                providerId: id,
                modelId: request.model,
                retryAfterMs: 60000,
              })
            );
            return;
          case 'timeout':
            yield err(
              createProviderError('provider.timeout', 'Request timed out', {
                providerId: id,
                modelId: request.model,
              })
            );
            return;
          case 'unavailable':
            yield err(
              createProviderError('provider.unavailable', 'Provider is unavailable', {
                providerId: id,
                modelId: request.model,
              })
            );
            return;
          case 'generic':
          default:
            yield err(
              createProviderError('provider.stream_error', 'Stream failed', {
                providerId: id,
                modelId: request.model,
              })
            );
            return;
        }
      }

      // Yield stream started event
      yield ok({
        type: 'stream.started' as const,
        timestamp,
        id: streamId,
        model: request.model,
        providerId: id,
      });

      // Yield content deltas
      for (const chunk of streamChunks) {
        if (streamDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, streamDelay));
        }
        yield ok({
          type: 'stream.content_delta' as const,
          timestamp: new Date().toISOString(),
          id: streamId,
          delta: chunk,
        });
      }

      // Yield usage event
      yield ok({
        type: 'stream.usage' as const,
        timestamp: new Date().toISOString(),
        id: streamId,
        usage: {
          promptTokens: 10,
          completionTokens: streamChunks.length,
          totalTokens: 10 + streamChunks.length,
        },
      });

      // Yield stream finished event
      yield ok({
        type: 'stream.finished' as const,
        timestamp: new Date().toISOString(),
        id: streamId,
        finishReason: 'stop',
      });
    },
  };

  return provider;
}

/**
 * Creates a fake provider that only supports text generation (no streaming)
 */
export function createNonStreamingFakeProvider(
  options: FakeProviderOptions = {}
): ModelProvider {
  return createFakeProvider({
    ...options,
    capabilities: ['text_generation'],
  });
}

/**
 * Creates a fake provider that simulates authentication errors
 */
export function createAuthErrorFakeProvider(
  options: FakeProviderOptions = {}
): ModelProvider {
  return createFakeProvider({
    ...options,
    simulateErrors: true,
    errorToSimulate: 'auth',
  });
}

/**
 * Creates a fake provider that simulates rate limit errors
 */
export function createRateLimitedFakeProvider(
  options: FakeProviderOptions = {}
): ModelProvider {
  return createFakeProvider({
    ...options,
    simulateErrors: true,
    errorToSimulate: 'rate_limit',
  });
}

/**
 * Creates a fake provider that simulates timeout errors
 */
export function createTimeoutFakeProvider(
  options: FakeProviderOptions = {}
): ModelProvider {
  return createFakeProvider({
    ...options,
    simulateErrors: true,
    errorToSimulate: 'timeout',
  });
}

/**
 * Creates a fake provider that simulates unavailability errors
 */
export function createUnavailableFakeProvider(
  options: FakeProviderOptions = {}
): ModelProvider {
  return createFakeProvider({
    ...options,
    simulateErrors: true,
    errorToSimulate: 'unavailable',
  });
}

/**
 * Creates a fake provider with all capabilities
 */
export function createFullCapabilityFakeProvider(
  options: FakeProviderOptions = {}
): ModelProvider {
  return createFakeProvider({
    ...options,
    capabilities: [
      'text_generation',
      'streaming',
      'tool_calls',
      'vision',
      'audio_input',
      'audio_output',
      'embedding',
    ],
  });
}
