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
import { createLogger } from '../../../lib/logger';
import {
  IdentityAdapterCodec,
  DeepSeekAdapterCodec,
  type ProviderAdapterCodec,
  type ToolNameMapping,
} from './provider-codec';

// =====================
// Default Configuration
// =====================

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 60000;
const PROVIDER_ID = 'openai-compatible';
const PROVIDER_NAME = 'OpenAI-Compatible';

// =====================
// Provider-Specific Codec Selection
// =====================

/**
 * Select the provider-specific codec for a given base URL.
 * Centralised here so the adapter code path never branches on
 * the provider identity — `mapTools`, `mapResponse`, and the
 * streaming event handling all consult the codec returned by
 * this function. Adding a new provider with quirks is a
 * one-line addition here plus a new codec class in
 * `provider-codec.ts`.
 */
function selectAdapterCodec(baseUrl: string): ProviderAdapterCodec {
  if (baseUrl.includes('deepseek.com')) {
    return new DeepSeekAdapterCodec();
  }
  return new IdentityAdapterCodec();
}

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
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly codec: ProviderAdapterCodec;

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

    this.logger = createLogger(this.config.providerId ?? PROVIDER_ID);
    this.codec = selectAdapterCodec(this.config.baseUrl);

    // Initialize OpenAI SDK client. The OpenAI SDK throws at construction
    // when the API key is empty, so fall back to a placeholder for local /
    // no-auth providers (e.g. Ollama, LM Studio) that ignore the header. A
    // real cloud provider with a genuinely missing key then degrades to a
    // clean 401 at request time instead of crashing here.
    this.client = new OpenAI({
      apiKey: this.config.apiKey || 'no-key-required',
      baseURL: this.config.baseUrl,
      organization: this.config.organizationId,
      defaultHeaders: this.config.headers,
      timeout: this.config.timeoutMs,
      fetch: this.config.credentialProvider
        ? this.wrapFetchWithCredentialLookup(
            this.config.providerId ?? PROVIDER_ID,
            this.config.credentialProvider,
          )
        : undefined,
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
  // Fetch Wrapper
  // =====================

  /**
   * Wraps the global `fetch` so that every outgoing request picks up
   * the latest credential from the supplied `credentialProvider`
   * callback. This is what allows a provider that was authenticated
   * via OAuth (and persists its token in the DB after startup) to
   * actually send a valid `Authorization` header on subsequent chat
   * calls without restarting the server.
   *
   * The SDK normally sets `Authorization: Bearer ${this.apiKey}` at
   * request time. If the credential provider yields a non-empty
   * token, we override that header on the per-request `RequestInit`
   * we hand to the underlying `fetch`. Otherwise the SDK's default
   * header (possibly empty) is left untouched, which is the right
   * behaviour for env-var-based API keys.
   */
  private wrapFetchWithCredentialLookup(
    providerId: string,
    credentialProvider: (providerId: string) => Promise<string | null>,
  ): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
    const baseFetch: typeof fetch | undefined =
      typeof fetch !== 'undefined' ? fetch : undefined;

    return async (input, init) => {
      let token: string | null = null;
      try {
        token = await credentialProvider(providerId);
      } catch (err) {
        this.logger.warn(
          `credentialProvider for "${providerId}" threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const headers = new Headers(init?.headers);
      if (token && token.length > 0) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const nextInit: RequestInit = { ...(init ?? {}), headers };
      if (baseFetch) {
        return baseFetch(input as Request | string | URL, nextInit);
      }
      throw new Error(
        'No global fetch available for OpenAI-compatible adapter',
      );
    };
  }

  // =====================
  // Model Management
  // =====================

  async listModels(): Promise<ProviderResult<readonly ModelDescriptor[]>> {
    try {
      const response = await this.client.models.list();

      // The `gpt`/`o1`/`chat`/`glm` name filter only makes sense for OpenAI
      // itself (its /models list is noisy with embeddings, audio, etc.). Any
      // other OpenAI-compatible endpoint — Ollama, LM Studio, Groq, … — uses
      // arbitrary model names, so return everything it reports.
      const isOpenAiCloud = this.config.baseUrl
        .toLowerCase()
        .includes('api.openai.com');
      const models: ModelDescriptor[] = response.data
        .filter(
          (model) =>
            !isOpenAiCloud ||
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
      this.logger.info(
        `invoke: model=${modelId} baseURL=${this.config.baseUrl}`,
      );
      this.logger.info(
        `invoke: request.tools = ${JSON.stringify(request.tools?.map((t) => t.name))}`,
      );
      const messages = this.mapMessages(request.messages);
      const toolMapping =
        request.tools && request.tools.length > 0
          ? this.mapTools(request.tools)
          : null;
      const tools = toolMapping?.wire ?? null;

      const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: modelId,
        messages,
        temperature: request.temperature ?? null,
        max_tokens: request.maxTokens ?? null,
        stream: false,
      };

      if (tools) {
        requestParams.tools = tools;
        this.logger.info(
          `invoke: requestParams.tools = ${JSON.stringify(tools)}`,
        );
      }

      this.logger.info(
        `invoke: final requestParams = ${JSON.stringify({ ...requestParams, messages: '[...]' })}`,
      );
      const response = await this.client.chat.completions.create(
        requestParams,
        request.signal ? { signal: request.signal } : {},
      );

      return ok(
        this.mapResponse(response, modelId, toolMapping?.nameMap ?? new Map()),
      );
    } catch (error) {
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

    // Accumulate tool call chunks — OpenAI streams them as partial deltas
    const pendingToolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();

    // Accumulate reasoning content for providers that stream it
    // (e.g. DeepSeek's thinking-mode models surface
    // `reasoning_content` deltas). The codec decides whether
    // any deltas are present; for the identity codec this
    // accumulator stays empty.
    let reasoningContent = '';

    try {
      const modelId =
        request.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
      this.logger.info(
        `invokeStream: model=${modelId} baseURL=${this.config.baseUrl}`,
      );
      const messages = this.mapMessages(request.messages);
      const toolMapping =
        request.tools && request.tools.length > 0
          ? this.mapTools(request.tools)
          : null;
      const tools = toolMapping?.wire ?? null;

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

      // Forward the caller's abort signal (e.g. user "Stop agent") to the SDK
      // so aborting it cancels the in-flight streaming request. The SDK applies
      // its own per-request timeout (config.timeoutMs) alongside this.
      const stream = await this.client.chat.completions.create(
        requestParams,
        request.signal ? { signal: request.signal } : {},
      );

      let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' =
        'stop';

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

        // Handle reasoning content delta (DeepSeek thinking mode
        // and any other provider that exposes it). The codec
        // extracts the delta from the chunk; for the identity
        // codec this returns null and the accumulator stays at
        // its previous value.
        const reasoningDelta = this.codec.extractReasoningDelta(chunk);
        if (reasoningDelta) {
          reasoningContent += reasoningDelta;
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

        // Accumulate tool call deltas by index (do NOT emit yet)
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index;
            if (!pendingToolCalls.has(idx)) {
              pendingToolCalls.set(idx, { id: '', name: '', arguments: '' });
            }
            const pending = pendingToolCalls.get(idx)!;
            if (tc.id) pending.id += tc.id;
            if (tc.function?.name) pending.name += tc.function.name;
            if (tc.function?.arguments)
              pending.arguments += tc.function.arguments;
          }
        }

        // Track finish reason
        if (choice.finish_reason) {
          finishReason =
            choice.finish_reason === 'function_call'
              ? 'tool_calls'
              : (choice.finish_reason as typeof finishReason);
        }
      }

      // Emit completed tool calls before stream.finished. The
      // codec restores the original tool name (the identity
      // codec returns the wire name unchanged).
      for (const tc of pendingToolCalls.values()) {
        yield ok({
          type: 'stream.tool_call',
          timestamp: new Date().toISOString(),
          id: tc.id,
          toolCall: {
            id: tc.id,
            type: 'function',
            name: this.codec.restoreName(
              tc.name,
              toolMapping?.nameMap ?? new Map(),
            ),
            arguments: tc.arguments,
          },
        });
      }

      // Emit finished
      if (started) {
        yield ok({
          type: 'stream.finished',
          timestamp: new Date().toISOString(),
          id: responseId,
          finishReason,
          ...(reasoningContent ? { reasoningContent } : {}),
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
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam & {
          reasoning_content?: string;
        } = {
          role: 'assistant',
          content: msg.content,
        };
        const aMsg = msg as import('@openaidy/runtime').AssistantMessage;
        if (aMsg.toolCalls && aMsg.toolCalls.length > 0) {
          assistantMsg.tool_calls = aMsg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          }));
        }
        // Round-trip the provider-specific reasoning content
        // (DeepSeek's thinking mode surfaces this in
        // `reasoning_content`; other providers ignore it).
        const reasoning = this.codec.pickRequestReasoningContent(aMsg);
        if (reasoning) {
          assistantMsg.reasoning_content = reasoning;
        }
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

  private mapTools(tools: NonNullable<ModelRequest['tools']>): {
    wire: OpenAI.Chat.ChatCompletionTool[];
    // Maps every wire-side (sanitized) name back to its
    // original. Empty for the identity codec; populated only
    // for codecs that need to translate names (e.g. DeepSeek's
    // `^[a-zA-Z0-9_-]+$` allow-list).
    nameMap: ToolNameMapping;
  } {
    const { wire, nameMap } = this.codec.prepareRequest(tools);
    return {
      wire: wire.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        },
      })),
      nameMap,
    };
  }

  private mapResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
    modelId: string,
    nameMap: ToolNameMapping,
  ): ModelResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choice in response');
    }

    const finishReason = choice.finish_reason ?? 'stop';
    const reasoningContent = this.codec.extractReasoningField(choice.message);

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
      ...(reasoningContent ? { reasoningContent } : {}),
    };

    // Restore the original tool name via the per-request map
    // for codecs that need it (e.g. DeepSeek's
    // `^[a-zA-Z0-9_-]+$` allow-list). The identity codec
    // returns the wire name unchanged.
    if (choice.message.tool_calls?.length) {
      return {
        ...result,
        toolCalls: choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: this.codec.restoreName(
            (tc as { function: { name: string } }).function.name,
            nameMap,
          ),
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
      this.logger.error(
        `Provider API error: HTTP ${error.status} ${error.message} (code=${error.code})`,
        { code: error.code, type: error.type, body: error.error },
      );
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
      this.logger.error(`Provider error: ${error.message}`);
      return createProviderError(
        'provider.unknown' as import('@openaidy/runtime').ProviderErrorCode,
        error.message,
      );
    }

    this.logger.error(`Unknown provider error: ${String(error)}`);
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
