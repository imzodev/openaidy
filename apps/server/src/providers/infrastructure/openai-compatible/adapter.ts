/**
 * OpenAI-Compatible Provider Adapter
 *
 * Implements the ModelProvider interface for OpenAI and OpenAI-compatible APIs.
 * Supports OpenAI itself, custom baseUrl endpoints, streaming, and normalized error mapping.
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
} from '@openaidy/runtime';
import { mapRequest } from './request-mapper';
import { mapResponse, mapStreamChunk, createToolCallAccumulator, updateToolCallAccumulator, finalizeToolCalls, mapFinishReason } from './response-mapper';
import { normalizeError, isOpenAIError } from './error-normalizer';
import type {
  OpenAICompatibleAdapterConfig,
  OpenAIChatCompletionResponse,
  OpenAIStreamChunk,
  OpenAIModelListResponse,
} from './types';

// =====================
// Default Configuration
// =====================

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 60000;
const PROVIDER_ID = 'openai-compatible';
const PROVIDER_NAME = 'OpenAI-Compatible';

// =====================
// Known Models
// =====================

/**
 * Common OpenAI models with their capabilities
 */
const KNOWN_MODELS: Record<string, { name: string; capabilities: ProviderCapability[] }> = {
  'gpt-4': {
    name: 'GPT-4',
    capabilities: ['text_generation', 'streaming', 'tool_calls'],
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'gpt-4o': {
    name: 'GPT-4o',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision', 'audio_input'],
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'gpt-3.5-turbo': {
    name: 'GPT-3.5 Turbo',
    capabilities: ['text_generation', 'streaming', 'tool_calls'],
  },
  'o1': {
    name: 'o1',
    capabilities: ['text_generation', 'streaming'],
  },
  'o1-mini': {
    name: 'o1 Mini',
    capabilities: ['text_generation', 'streaming'],
  },
  'o1-preview': {
    name: 'o1 Preview',
    capabilities: ['text_generation', 'streaming'],
  },
};

// =====================
// OpenAI-Compatible Provider
// =====================

/**
 * OpenAI-Compatible Provider Adapter
 *
 * Implements the ModelProvider interface for OpenAI and compatible APIs.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  private readonly config: Required<
    Pick<OpenAICompatibleAdapterConfig, 'apiKey' | 'baseUrl'>
  > &
    OpenAICompatibleAdapterConfig;

  readonly descriptor: ProviderDescriptor;

  constructor(config: OpenAICompatibleAdapterConfig) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      defaultModel: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      enableStreaming: true,
      enableTools: true,
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
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

    this.descriptor = {
      id: this.config.providerId ?? PROVIDER_ID,
      name: this.config.providerName ?? PROVIDER_NAME,
      description: `OpenAI-compatible provider at ${this.config.baseUrl}`,
      capabilities,
      vendorFamily: 'openai-compatible',
    };
  }

  // =====================
  // Model Management
  // =====================

  async listModels(): Promise<ProviderResult<readonly ModelDescriptor[]>> {
    try {
      const response = await this.fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.createAbortSignal(),
      });

      if (!response.ok) {
        return err(normalizeError(response, { providerId: this.descriptor.id }));
      }

      const data = (await response.json()) as OpenAIModelListResponse;

      // Filter to chat models and map to descriptors
      const models: ModelDescriptor[] = data.data
        .filter((model) => model.id.includes('gpt') || model.id.includes('o1') || model.id.includes('chat'))
        .map((model) => {
          const known = KNOWN_MODELS[model.id];
          return {
            id: model.id,
            providerId: this.descriptor.id,
            name: known?.name ?? model.id,
            capabilities: known?.capabilities ?? ['text_generation', 'streaming'],
          };
        });

      // If no models found, return default model
      if (models.length === 0) {
        models.push({
          id: this.config.defaultModel ?? DEFAULT_MODEL,
          providerId: this.descriptor.id,
          name: 'Default Model',
          capabilities: ['text_generation', 'streaming'],
        });
      }

      return ok(models);
    } catch (error) {
      return err(normalizeError(error, { providerId: this.descriptor.id }));
    }
  }

  async getModel(modelId: string): Promise<ProviderResult<ModelDescriptor>> {
    // Check known models first
    const known = KNOWN_MODELS[modelId];
    if (known) {
      return ok({
        id: modelId,
        providerId: this.descriptor.id,
        name: known.name,
        capabilities: known.capabilities,
      });
    }

    // Try to fetch from API
    try {
      const response = await this.fetch(`${this.config.baseUrl}/models/${modelId}`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.createAbortSignal(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return err(
            createProviderError('provider.model_not_found', `Model "${modelId}" not found`, {
              providerId: this.descriptor.id,
              modelId,
            })
          );
        }
        return err(normalizeError(response, { providerId: this.descriptor.id, modelId }));
      }

      const data = await response.json();
      return ok({
        id: modelId,
        providerId: this.descriptor.id,
        name: (data as { id: string }).id,
        capabilities: ['text_generation', 'streaming'],
      });
    } catch (_error) {
      // For unknown models, return a generic descriptor
      // This allows the adapter to work with custom models
      return ok({
        id: modelId,
        providerId: this.descriptor.id,
        name: modelId,
        capabilities: ['text_generation', 'streaming'],
      });
    }
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
    if (request.tools && request.tools.length > 0 && !this.hasCapability('tool_calls')) {
      return err(
        createProviderError(
          'provider.capability_unsupported',
          `Provider "${this.descriptor.id}" does not support tool calls`,
          { providerId: this.descriptor.id, modelId: request.model }
        )
      );
    }

    try {
      const openAIRequest = mapRequest({ ...request, stream: false });

      const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(openAIRequest),
        signal: this.createAbortSignal(),
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
          normalizeError(isOpenAIError(errorData) ? errorData : response, {
            providerId: this.descriptor.id,
            modelId: request.model,
          })
        );
      }

      const data = (await response.json()) as OpenAIChatCompletionResponse;
      return ok(mapResponse(data, this.descriptor.id));
    } catch (error) {
      return err(normalizeError(error, { providerId: this.descriptor.id, modelId: request.model }));
    }
  }

  // =====================
  // Streaming Invocation
  // =====================

  async *invokeStream(request: ModelRequest): AsyncIterable<ProviderResult<ModelStreamEvent>> {
    // Check streaming capability
    if (!this.hasCapability('streaming')) {
      yield err(
        createProviderError(
          'provider.capability_unsupported',
          `Provider "${this.descriptor.id}" does not support streaming`,
          { providerId: this.descriptor.id, modelId: request.model }
        )
      );
      return;
    }

    const responseId = `stream_${Date.now()}`;
    let started = false;
    const toolCallAccumulator = createToolCallAccumulator();

    try {
      const openAIRequest = mapRequest({ ...request, stream: true });

      const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...this.getHeaders(), Accept: 'text/event-stream' },
        body: JSON.stringify(openAIRequest),
        signal: this.createAbortSignal(),
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
          normalizeError(isOpenAIError(errorData) ? errorData : response, {
            providerId: this.descriptor.id,
            modelId: request.model,
          })
        );
        return;
      }

      if (!response.body) {
        yield err(
          createProviderError('provider.stream_error', 'Response body is null', {
            providerId: this.descriptor.id,
            modelId: request.model,
          })
        );
        return;
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null = null;

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

            // Check for end of stream
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data) as OpenAIStreamChunk;
              const choice = chunk.choices[0];

              if (!choice) continue;

              // Emit stream.started on first chunk
              if (!started) {
                started = true;
                yield ok({
                  type: 'stream.started',
                  timestamp: new Date().toISOString(),
                  id: chunk.id,
                  model: chunk.model,
                  providerId: this.descriptor.id,
                });
              }

              // Track tool calls
              if (choice.delta.tool_calls) {
                updateToolCallAccumulator(toolCallAccumulator, choice.delta.tool_calls);
              }

              // Map content deltas
              for (const event of mapStreamChunk(chunk, this.descriptor.id, chunk.id)) {
                yield ok(event);
              }

              // Track finish reason
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
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
            id: responseId,
            toolCall,
          });
        }
      }

      // Emit stream.finished
      yield ok({
        type: 'stream.finished',
        timestamp: new Date().toISOString(),
        id: responseId,
        finishReason: mapFinishReason(finishReason),
      });
    } catch (error) {
      yield err(normalizeError(error, { providerId: this.descriptor.id, modelId: request.model }));
    }
  }

  // =====================
  // Private Helpers
  // =====================

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    if (this.config.organizationId) {
      headers['OpenAI-Organization'] = this.config.organizationId;
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  private createAbortSignal(): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return controller.signal;
  }

  private async fetch(url: string, options: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}

// =====================
// Factory Function
// =====================

/**
 * Creates an OpenAI-compatible provider instance
 */
export function createOpenAICompatibleProvider(
  config: OpenAICompatibleAdapterConfig
): ModelProvider {
  return new OpenAICompatibleProvider(config);
}

/**
 * Creates a standard OpenAI provider instance with defaults
 */
export function createOpenAIProvider(apiKey: string, options?: Partial<OpenAICompatibleAdapterConfig>): ModelProvider {
  return createOpenAICompatibleProvider({
    apiKey,
    providerId: 'openai',
    providerName: 'OpenAI',
    baseUrl: DEFAULT_BASE_URL,
    defaultModel: DEFAULT_MODEL,
    ...options,
  });
}

/**
 * Creates a custom OpenAI-compatible provider (e.g., for local models or gateways)
 */
export function createCompatibleProvider(
  baseUrl: string,
  apiKey: string,
  options?: Partial<OpenAICompatibleAdapterConfig>
): ModelProvider {
  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl,
    ...options,
  });
}
