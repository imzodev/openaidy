/**
 * Anthropic Provider Adapter
 *
 * Implements the ModelProvider interface for Anthropic Claude API.
 * Supports the Messages API, streaming, and normalized error mapping.
 */

import {
  ok,
  err,
  createProviderError,
  type ModelProvider,
  type ProviderDescriptor,
  type ProviderCapability,
  type ModelDescriptor,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ProviderResult,
  type FinishReason,
} from '@openaidy/runtime';
import { mapRequest } from './request-mapper';
import {
  mapResponse,
  mapStreamEvent,
  createToolCallAccumulator,
  updateToolCallAccumulator,
  finalizeToolCalls,
  extractStopReasonFromDelta,
} from './response-mapper';
import { normalizeError, isAnthropicError } from './error-normalizer';
import type {
  AnthropicAdapterConfig,
  AnthropicMessagesResponse,
  AnthropicStreamEvent,
} from './types';

// =====================
// Default Configuration
// =====================

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_TIMEOUT_MS = 120000; // Anthropic can be slower
const DEFAULT_MAX_TOKENS = 4096;
const PROVIDER_ID = 'anthropic';
const PROVIDER_NAME = 'Anthropic';

// =====================
// Known Models
// =====================

/**
 * Common Anthropic models with their capabilities
 */
const KNOWN_MODELS: Record<
  string,
  { name: string; capabilities: ProviderCapability[] }
> = {
  'claude-opus-4-20250514': {
    name: 'Claude Opus 4',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'claude-sonnet-4-20250514': {
    name: 'Claude Sonnet 4',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'claude-3-5-sonnet-20241022': {
    name: 'Claude 3.5 Sonnet',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'claude-3-5-haiku-20241022': {
    name: 'Claude 3.5 Haiku',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'claude-3-opus-20240229': {
    name: 'Claude 3 Opus',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'claude-3-sonnet-20240229': {
    name: 'Claude 3 Sonnet',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'claude-3-haiku-20240307': {
    name: 'Claude 3 Haiku',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
};

// =====================
// Anthropic Provider
// =====================

/**
 * Anthropic Provider Adapter
 *
 * Implements the ModelProvider interface for Anthropic Claude.
 */
export class AnthropicProvider implements ModelProvider {
  private readonly config: Required<
    Pick<AnthropicAdapterConfig, 'apiKey' | 'baseUrl' | 'apiVersion'>
  > &
    AnthropicAdapterConfig;

  readonly descriptor: ProviderDescriptor;

  constructor(config: AnthropicAdapterConfig) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      apiVersion: DEFAULT_API_VERSION,
      defaultModel: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      enableStreaming: true,
      enableTools: true,
      enableVision: true,
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
      defaultTemperature: 0.7,
      ...config,
    };

    // Build capabilities based on config
    const capabilities: ProviderCapability[] = ['text_generation'];
    if (this.config.enableStreaming !== false) {
      capabilities.push('streaming');
    }
    if (this.config.enableTools !== false) {
      capabilities.push('tool_calls');
    }
    if (this.config.enableVision !== false) {
      capabilities.push('vision');
    }

    this.descriptor = {
      id: this.config.providerId ?? PROVIDER_ID,
      name: this.config.providerName ?? PROVIDER_NAME,
      description: `Anthropic Claude provider (${this.config.apiVersion})`,
      capabilities,
      vendorFamily: 'anthropic',
    };
  }

  // =====================
  // Model Management
  // =====================

  async listModels(): Promise<ProviderResult<readonly ModelDescriptor[]>> {
    // Anthropic doesn't have a list models endpoint
    // Return known models based on documentation
    const models: ModelDescriptor[] = Object.entries(KNOWN_MODELS).map(
      ([id, info]) => ({
        id,
        providerId: this.descriptor.id,
        name: info.name,
        capabilities: this.buildModelCapabilities(info.capabilities),
      }),
    );

    // Add default model if not in known list
    if (!models.find((m) => m.id === this.config.defaultModel)) {
      models.push({
        id: this.config.defaultModel!,
        providerId: this.descriptor.id,
        name: this.config.defaultModel!,
        capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
      });
    }

    return ok(models);
  }

  async getModel(modelId: string): Promise<ProviderResult<ModelDescriptor>> {
    // Check known models first
    const known = KNOWN_MODELS[modelId];
    if (known) {
      return ok({
        id: modelId,
        providerId: this.descriptor.id,
        name: known.name,
        capabilities: this.buildModelCapabilities(known.capabilities),
      });
    }

    // For unknown models, return a generic descriptor
    // This allows the adapter to work with new models
    return ok({
      id: modelId,
      providerId: this.descriptor.id,
      name: modelId,
      capabilities: this.buildModelCapabilities([
        'text_generation',
        'streaming',
      ]),
    });
  }

  private buildModelCapabilities(
    modelCaps: ProviderCapability[],
  ): ProviderCapability[] {
    const caps: ProviderCapability[] = ['text_generation'];

    if (
      modelCaps.includes('streaming') &&
      this.config.enableStreaming !== false
    ) {
      caps.push('streaming');
    }
    if (modelCaps.includes('tool_calls') && this.config.enableTools !== false) {
      caps.push('tool_calls');
    }
    if (modelCaps.includes('vision') && this.config.enableVision !== false) {
      caps.push('vision');
    }

    return caps;
  }

  // =====================
  // Capability Check
  // =====================

  hasCapability(capability: ProviderCapability): boolean {
    return this.descriptor.capabilities.includes(capability);
  }

  // =====================
  // Non-Streaming Invocation
  // =====================

  async invoke(request: ModelRequest): Promise<ProviderResult<ModelResponse>> {
    // Check capabilities
    if (
      request.tools &&
      request.tools.length > 0 &&
      !this.hasCapability('tool_calls')
    ) {
      return err(
        createProviderError(
          'provider.capability_unsupported',
          `Provider "${this.descriptor.id}" does not support tool calls`,
          { providerId: this.descriptor.id, modelId: request.model },
        ),
      );
    }

    try {
      // Build options, filtering out undefined values for exactOptionalPropertyTypes
      const mapperOptions: {
        defaultMaxTokens?: number;
        defaultTemperature?: number;
      } = {};
      if (this.config.defaultMaxTokens !== undefined) {
        mapperOptions.defaultMaxTokens = this.config.defaultMaxTokens;
      }
      if (this.config.defaultTemperature !== undefined) {
        mapperOptions.defaultTemperature = this.config.defaultTemperature;
      }

      const anthropicRequest = mapRequest(request, mapperOptions);

      const response = await this.fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(anthropicRequest),
        signal: this.createAbortSignal(request.signal),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          errorData = errorBody;
        }
        return err(
          normalizeError(isAnthropicError(errorData) ? errorData : response, {
            providerId: this.descriptor.id,
            modelId: request.model,
          }),
        );
      }

      const data = (await response.json()) as AnthropicMessagesResponse;
      return ok(mapResponse(data, this.descriptor.id));
    } catch (error) {
      return err(
        normalizeError(error, {
          providerId: this.descriptor.id,
          modelId: request.model,
        }),
      );
    }
  }

  // =====================
  // Streaming Invocation
  // =====================

  async *invokeStream(
    request: ModelRequest,
  ): AsyncIterable<ProviderResult<ModelStreamEvent>> {
    // Check streaming capability
    if (!this.hasCapability('streaming')) {
      yield err(
        createProviderError(
          'provider.capability_unsupported',
          `Provider "${this.descriptor.id}" does not support streaming`,
          { providerId: this.descriptor.id, modelId: request.model },
        ),
      );
      return;
    }

    const streamId = `stream_${Date.now()}`;
    const toolCallAccumulator = createToolCallAccumulator();
    // Track finish reason for potential future use (e.g., logging, debugging)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const finishReason: FinishReason = 'stop';
    let messageId = streamId;
    let model = request.model;
    // Prompt-side usage from message_start (input + cache tokens); combined
    // with output tokens from message_delta to emit a complete usage figure.
    let promptUsage:
      | {
          promptTokens: number;
          cacheReadTokens?: number;
          cacheCreationTokens?: number;
        }
      | undefined;

    try {
      // Build options, filtering out undefined values for exactOptionalPropertyTypes
      const mapperOptions: {
        defaultMaxTokens?: number;
        defaultTemperature?: number;
      } = {};
      if (this.config.defaultMaxTokens !== undefined) {
        mapperOptions.defaultMaxTokens = this.config.defaultMaxTokens;
      }
      if (this.config.defaultTemperature !== undefined) {
        mapperOptions.defaultTemperature = this.config.defaultTemperature;
      }

      const anthropicRequest = mapRequest(
        { ...request, stream: true },
        mapperOptions,
      );

      const response = await this.fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: { ...this.getHeaders(), Accept: 'text/event-stream' },
        body: JSON.stringify(anthropicRequest),
        signal: this.createAbortSignal(request.signal),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          errorData = errorBody;
        }
        yield err(
          normalizeError(isAnthropicError(errorData) ? errorData : response, {
            providerId: this.descriptor.id,
            modelId: request.model,
          }),
        );
        return;
      }

      if (!response.body) {
        yield err(
          createProviderError(
            'provider.stream_error',
            'Response body is null',
            {
              providerId: this.descriptor.id,
              modelId: request.model,
            },
          ),
        );
        return;
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Skip empty lines and comments
          if (!trimmed || trimmed.startsWith(':')) continue;

          // Parse SSE data
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);

            try {
              const event = JSON.parse(data) as AnthropicStreamEvent;

              // Track message ID and model from message_start
              if (event.type === 'message_start') {
                messageId = event.message.id;
                model = event.message.model;
                // Capture prompt-side usage here — the closing message_delta
                // only reports output tokens.
                const u = event.message.usage;
                const cacheRead = u.cache_read_input_tokens ?? 0;
                const cacheCreation = u.cache_creation_input_tokens ?? 0;
                promptUsage = {
                  promptTokens: u.input_tokens + cacheRead + cacheCreation,
                  ...(u.cache_read_input_tokens !== undefined && {
                    cacheReadTokens: cacheRead,
                  }),
                  ...(u.cache_creation_input_tokens !== undefined && {
                    cacheCreationTokens: cacheCreation,
                  }),
                };
              }

              // Track tool calls
              if (
                event.type === 'content_block_start' ||
                event.type === 'content_block_delta'
              ) {
                updateToolCallAccumulator(toolCallAccumulator, event);
              }

              // Track finish reason from message_delta
              if (event.type === 'message_delta') {
                const extractedReason = extractStopReasonFromDelta(event);
                if (extractedReason) {
                  // finishReason is tracked but not used in current implementation
                  // Could be useful for logging/debugging in the future
                }
              }

              // Map events to normalized format
              for (const normalizedEvent of mapStreamEvent(
                event,
                this.descriptor.id,
                messageId,
                model,
                promptUsage,
              )) {
                yield ok(normalizedEvent);
              }
            } catch {
              // Skip malformed JSON
              continue;
            }
          }
        }
      }

      // Emit tool call events for accumulated tool calls
      const toolCalls = finalizeToolCalls(toolCallAccumulator);
      if (toolCalls) {
        for (const toolCall of toolCalls) {
          yield ok({
            type: 'stream.tool_call',
            timestamp: new Date().toISOString(),
            id: messageId,
            toolCall,
          });
        }
      }

      // Note: finish reason tracking for tool calls could be added here if needed
    } catch (error) {
      yield err(
        normalizeError(error, {
          providerId: this.descriptor.id,
          modelId: request.model,
        }),
      );
      return;
    }

    // Note: stream.finished is emitted by mapStreamEvent on message_stop
  }

  // =====================
  // Private Helpers
  // =====================

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': this.config.apiVersion,
    };

    // Add beta headers if configured
    if (this.config.betas && this.config.betas.length > 0) {
      headers['anthropic-beta'] = this.config.betas.join(',');
    }

    // Add custom headers
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  private createAbortSignal(external?: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (external) {
      if (external.aborted) {
        clearTimeout(timeoutId);
        controller.abort();
      } else {
        external.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutId);
            controller.abort();
          },
          { once: true },
        );
      }
    }
    return controller.signal;
  }

  private async fetch(url: string, options: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}

// =====================
// Factory Functions
// =====================

/**
 * Creates an Anthropic provider instance
 */
export function createAnthropicProvider(
  config: AnthropicAdapterConfig,
): ModelProvider {
  return new AnthropicProvider(config);
}

/**
 * Creates an Anthropic provider with standard configuration
 */
export function createClaudeProvider(
  apiKey: string,
  options?: Partial<AnthropicAdapterConfig>,
): ModelProvider {
  return createAnthropicProvider({
    apiKey,
    providerId: 'anthropic',
    providerName: 'Anthropic',
    baseUrl: DEFAULT_BASE_URL,
    defaultModel: DEFAULT_MODEL,
    ...options,
  });
}

/**
 * Creates an Anthropic provider with a specific model
 */
export function createClaudeModelProvider(
  apiKey: string,
  model: string,
  options?: Partial<AnthropicAdapterConfig>,
): ModelProvider {
  return createAnthropicProvider({
    apiKey,
    providerId: `anthropic-${model}`,
    providerName: `Anthropic ${model}`,
    defaultModel: model,
    ...options,
  });
}
