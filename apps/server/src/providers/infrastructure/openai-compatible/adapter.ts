/**
 * OpenAI-Compatible Provider Adapter
 *
 * Implements the ModelProvider interface using the official OpenAI SDK.
 * Supports OpenAI itself and OpenAI-compatible APIs (like Z.AI, Groq, etc.)
 */

import OpenAI from 'openai';
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
import type { OpenAICompatibleAdapterConfig } from './types';

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

const KNOWN_MODELS: Record<
  string,
  { name: string; capabilities: ProviderCapability[] }
> = {
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
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'gpt-3.5-turbo': {
    name: 'GPT-3.5 Turbo',
    capabilities: ['text_generation', 'streaming', 'tool_calls'],
  },
  o1: {
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
  'glm-5': {
    name: 'GLM-5',
    capabilities: ['text_generation', 'streaming', 'tool_calls'],
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
  private readonly client: OpenAI;
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

    // Initialize OpenAI SDK client
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      organization: this.config.organizationId,
      defaultHeaders: this.config.headers,
      timeout: this.config.timeoutMs,
    });

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
      const response = await this.client.models.list();

      // Filter to chat models and map to descriptors
      const models: ModelDescriptor[] = response.data
        .filter(
          (model) =>
            model.id.includes('gpt') ||
            model.id.includes('o1') ||
            model.id.includes('chat') ||
            model.id.includes('glm'),
        )
        .map((model) => {
          const known = KNOWN_MODELS[model.id];
          return {
            id: model.id,
            providerId: this.descriptor.id,
            name: known?.name ?? model.id,
            capabilities: known?.capabilities ?? [
              'text_generation',
              'streaming',
            ],
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
      return err(this.normalizeError(error));
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
      await this.client.models.retrieve(modelId);
      return ok({
        id: modelId,
        providerId: this.descriptor.id,
        name: modelId,
        capabilities: ['text_generation', 'streaming'],
      });
    } catch (_error) {
      // For unknown models, return a generic descriptor
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
      const modelId =
        request.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
      const messages = this.mapMessages(request.messages);
      const tools =
        request.tools && request.tools.length > 0
          ? this.mapTools(request.tools)
          : null;

      console.log('[DEBUG] OpenAI SDK Request:', {
        model: modelId,
        messages: messages.length,
        tools: tools?.length,
      });

      const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: modelId,
        messages,
        temperature: request.temperature ?? null,
        max_tokens: request.maxTokens ?? null,
        stream: false,
      };

      if (tools) {
        requestParams.tools = tools;
      }

      const response = await this.client.chat.completions.create(requestParams);

      console.log('[DEBUG] OpenAI SDK Response:', {
        id: response.id,
        model: response.model,
      });

      return ok(this.mapResponse(response, modelId));
    } catch (error) {
      console.log('[DEBUG] OpenAI SDK Error:', error);
      return err(this.normalizeError(error));
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

    const responseId = `stream_${Date.now()}`;
    let started = false;

    try {
      const modelId =
        request.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
      const messages = this.mapMessages(request.messages);
      const tools =
        request.tools && request.tools.length > 0
          ? this.mapTools(request.tools)
          : null;

      const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: modelId,
        messages,
        temperature: request.temperature ?? null,
        max_tokens: request.maxTokens ?? null,
        stream: true,
      };

      if (tools) {
        requestParams.tools = tools;
      }

      const stream = await this.client.chat.completions.create(requestParams);

      for await (const chunk of stream) {
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

        // Handle content delta
        if (choice.delta?.content) {
          yield ok({
            type: 'stream.content_delta',
            timestamp: new Date().toISOString(),
            id: responseId,
            delta: choice.delta.content,
          });
        }

        // Handle tool calls
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            if (tc.function) {
              yield ok({
                type: 'stream.tool_call',
                timestamp: new Date().toISOString(),
                id: tc.id ?? '',
                toolCall: {
                  id: tc.id ?? '',
                  type: 'function',
                  name: tc.function.name ?? '',
                  arguments: tc.function.arguments ?? '',
                },
              });
            }
          }
        }

        // Check for finish reason
        if (choice.finish_reason) {
          const finishReason =
            choice.finish_reason === 'function_call'
              ? 'tool_calls'
              : (choice.finish_reason as
                  | 'stop'
                  | 'length'
                  | 'tool_calls'
                  | 'content_filter');
          yield ok({
            type: 'stream.finished',
            timestamp: new Date().toISOString(),
            id: responseId,
            finishReason,
          });
        }
      }

      // Ensure we emit finished if not already done
      if (started) {
        yield ok({
          type: 'stream.finished',
          timestamp: new Date().toISOString(),
          id: responseId,
          finishReason: 'stop' as const,
        });
      }
    } catch (error) {
      yield err(this.normalizeError(error));
    }
  }

  // =====================
  // Private Helpers
  // =====================

  private mapMessages(
    messages: ModelRequest['messages'],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content };
      }
      if (msg.role === 'user') {
        return { role: 'user', content: msg.content };
      }
      if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content,
        };
        return assistantMsg;
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: (msg as { toolCallId?: string }).toolCallId ?? '',
        };
      }
      // Fallback for any other message types
      return {
        role: 'user',
        content: (msg as { content?: string }).content ?? '',
      };
    });
  }

  private mapTools(
    tools: NonNullable<ModelRequest['tools']>,
  ): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private mapResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
    modelId: string,
  ): ModelResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choice in response');
    }

    const finishReason = choice.finish_reason ?? 'stop';

    const result: ModelResponse = {
      id: response.id,
      model: modelId,
      providerId: this.descriptor.id,
      content: choice.message.content ?? '',
      finishReason: finishReason as
        | 'stop'
        | 'length'
        | 'tool_calls'
        | 'content_filter',
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      created: new Date().toISOString(),
    };

    // Only add toolCalls if there are tool calls
    if (choice.message.tool_calls?.length) {
      return {
        ...result,
        toolCalls: choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: (tc as { function: { name: string } }).function.name,
          arguments: (tc as { function: { arguments: string } }).function
            .arguments,
        })),
      };
    }

    return result;
  }

  private normalizeError(
    error: unknown,
  ): ReturnType<typeof createProviderError> {
    if (error instanceof OpenAI.APIError) {
      const errorCode =
        error.code === 'rate_limit_exceeded'
          ? 'provider.rate_limit'
          : 'provider.api_error';
      return createProviderError(
        errorCode as import('@openaidy/runtime').ProviderErrorCode,
        error.message,
        { cause: { code: error.code, type: error.type } },
      );
    }

    if (error instanceof Error) {
      return createProviderError(
        'provider.unknown' as import('@openaidy/runtime').ProviderErrorCode,
        error.message,
      );
    }

    return createProviderError(
      'provider.unknown' as import('@openaidy/runtime').ProviderErrorCode,
      'Unknown error occurred',
    );
  }
}

// =====================
// Factory Function
// =====================

/**
 * Creates an OpenAI-compatible provider instance
 */
export function createOpenAICompatibleProvider(
  config: OpenAICompatibleAdapterConfig,
): ModelProvider {
  return new OpenAICompatibleProvider(config);
}

/**
 * Creates a standard OpenAI provider instance with defaults
 */
export function createOpenAIProvider(
  apiKey: string,
  options?: Partial<OpenAICompatibleAdapterConfig>,
): ModelProvider {
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
  options?: Partial<OpenAICompatibleAdapterConfig>,
): ModelProvider {
  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl,
    ...options,
  });
}
