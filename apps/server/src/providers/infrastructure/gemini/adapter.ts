/**
 * Gemini Provider Adapter
 *
 * Implements the ModelProvider interface for Google Gemini API.
 * Supports AI Studio and Vertex AI, streaming, and normalized error mapping.
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
import { mapResponse, mapStreamChunk, mapFinishReason } from './response-mapper';
import { normalizeError, isGeminiError } from './error-normalizer';
import type { GeminiAdapterConfig, GeminiGenerateContentResponse, GeminiStreamChunk, GeminiSafetySetting } from './types';

// =====================
// Default Configuration
// =====================

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TIMEOUT_MS = 60000;
const PROVIDER_ID = 'gemini';
const PROVIDER_NAME = 'Google Gemini';

// =====================
// Known Models
// =====================

/**
 * Common Gemini models with their capabilities
 */
const KNOWN_MODELS: Record<string, { name: string; capabilities: ProviderCapability[] }> = {
  'gemini-2.5-pro-preview-06-05': {
    name: 'Gemini 2.5 Pro',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision', 'audio_input'],
  },
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision', 'audio_input'],
  },
  'gemini-2.0-flash-lite': {
    name: 'Gemini 2.0 Flash Lite',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'gemini-1.5-pro': {
    name: 'Gemini 1.5 Pro',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision', 'audio_input'],
  },
  'gemini-1.5-flash': {
    name: 'Gemini 1.5 Flash',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision', 'audio_input'],
  },
  'gemini-1.5-flash-8b': {
    name: 'Gemini 1.5 Flash 8B',
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
  },
  'gemini-1.0-pro': {
    name: 'Gemini 1.0 Pro',
    capabilities: ['text_generation', 'streaming', 'tool_calls'],
  },
};

// =====================
// Gemini Provider
// =====================

/**
 * Gemini Provider Adapter
 *
 * Implements the ModelProvider interface for Google Gemini.
 */
export class GeminiProvider implements ModelProvider {
  private readonly config: Required<
    Pick<GeminiAdapterConfig, 'apiKey' | 'baseUrl'>
  > &
    GeminiAdapterConfig;

  readonly descriptor: ProviderDescriptor;

  constructor(config: GeminiAdapterConfig) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      defaultModel: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      enableStreaming: true,
      enableTools: true,
      enableVision: true,
      enableAudioInput: true,
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      defaultTemperature: 0.7,
      defaultMaxTokens: 8192,
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
    if (this.config.enableAudioInput !== false) {
      capabilities.push('audio_input');
    }

    this.descriptor = {
      id: this.config.providerId ?? PROVIDER_ID,
      name: this.config.providerName ?? PROVIDER_NAME,
      description: `Google Gemini provider (${this.config.useVertexAI ? 'Vertex AI' : 'AI Studio'})`,
      capabilities,
      vendorFamily: 'gemini',
    };
  }

  // =====================
  // Model Management
  // =====================

  async listModels(): Promise<ProviderResult<readonly ModelDescriptor[]>> {
    try {
      const url = `${this.config.baseUrl}/models?key=${this.config.apiKey}`;
      
      const response = await this.fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.createAbortSignal(),
      });

      if (!response.ok) {
        return err(normalizeError(response, { providerId: this.descriptor.id }));
      }

      const data = await response.json() as { models: Array<{ name: string; displayName?: string }> };
      
      // Filter to Gemini models and map to descriptors
      const models: ModelDescriptor[] = (data.models || [])
        .filter((model) => model.name.includes('gemini'))
        .map((model) => {
          const modelId = model.name.replace('models/', '');
          const known = KNOWN_MODELS[modelId];
          return {
            id: modelId,
            providerId: this.descriptor.id,
            name: known?.name ?? model.displayName ?? modelId,
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
      const url = `${this.config.baseUrl}/models/${modelId}?key=${this.config.apiKey}`;
      
      const response = await this.fetch(url, {
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

      const data = await response.json() as { name?: string; displayName?: string };
      return ok({
        id: modelId,
        providerId: this.descriptor.id,
        name: data.displayName ?? data.name?.replace('models/', '') ?? modelId,
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
      const options: {
        defaultTemperature?: number;
        defaultMaxTokens?: number;
        safetySettings?: GeminiSafetySetting[];
        systemInstruction?: string;
      } = {};
      
      if (this.config.defaultTemperature !== undefined) {
        options.defaultTemperature = this.config.defaultTemperature;
      }
      if (this.config.defaultMaxTokens !== undefined) {
        options.defaultMaxTokens = this.config.defaultMaxTokens;
      }
      if (this.config.safetySettings !== undefined) {
        options.safetySettings = this.config.safetySettings;
      }
      if (this.config.systemInstruction !== undefined) {
        options.systemInstruction = this.config.systemInstruction;
      }
      
      const geminiRequest = mapRequest({ ...request, stream: false }, options);

      const url = `${this.config.baseUrl}/models/${request.model}:generateContent?key=${this.config.apiKey}`;

      const response = await this.fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(geminiRequest),
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
          normalizeError(isGeminiError(errorData) ? errorData : response, {
            providerId: this.descriptor.id,
            modelId: request.model,
          })
        );
      }

      const data = (await response.json()) as GeminiGenerateContentResponse;
      const mapped = mapResponse(data, this.descriptor.id);
      
      return ok({
        ...mapped,
        model: request.model,
      });
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

    const streamId = `stream_${Date.now()}`;
    let started = false;

    try {
      const options: {
        defaultTemperature?: number;
        defaultMaxTokens?: number;
        safetySettings?: GeminiSafetySetting[];
        systemInstruction?: string;
      } = {};
      
      if (this.config.defaultTemperature !== undefined) {
        options.defaultTemperature = this.config.defaultTemperature;
      }
      if (this.config.defaultMaxTokens !== undefined) {
        options.defaultMaxTokens = this.config.defaultMaxTokens;
      }
      if (this.config.safetySettings !== undefined) {
        options.safetySettings = this.config.safetySettings;
      }
      if (this.config.systemInstruction !== undefined) {
        options.systemInstruction = this.config.systemInstruction;
      }
      
      const geminiRequest = mapRequest({ ...request, stream: true }, options);

      const url = `${this.config.baseUrl}/models/${request.model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`;

      const response = await this.fetch(url, {
        method: 'POST',
        headers: { ...this.getHeaders(), Accept: 'text/event-stream' },
        body: JSON.stringify(geminiRequest),
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
          normalizeError(isGeminiError(errorData) ? errorData : response, {
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
      let finishReason: Exclude<import('@openaidy/runtime').FinishReason, 'error'> | null = null;

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
              const chunk = JSON.parse(data) as GeminiStreamChunk;
              const candidate = chunk.candidates[0];

              if (!candidate) continue;

              // Emit stream.started on first chunk
              if (!started) {
                started = true;
                yield ok({
                  type: 'stream.started',
                  timestamp: new Date().toISOString(),
                  id: streamId,
                  model: request.model,
                  providerId: this.descriptor.id,
                });
              }

              // Map chunk events
              for (const event of mapStreamChunk(chunk, this.descriptor.id, streamId)) {
                yield ok(event);
              }

              // Track finish reason (exclude 'error' as it's not valid for stream.finished)
              if (candidate.finishReason) {
                const mapped = mapFinishReason(candidate.finishReason);
                if (mapped !== 'error') {
                  finishReason = mapped;
                }
              }
            } catch {
              // Skip malformed JSON
              continue;
            }
          }
        }
      }

      // Emit stream.finished
      yield ok({
        type: 'stream.finished',
        timestamp: new Date().toISOString(),
        id: streamId,
        finishReason: finishReason ?? 'stop',
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
    };

    // For Vertex AI, use different auth
    if (this.config.useVertexAI) {
      // Vertex AI uses OAuth tokens, not API keys
      // This would typically be handled via Google Auth Library
      // For now, we assume the apiKey is an OAuth token
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
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
// Factory Functions
// =====================

/**
 * Creates a Gemini provider instance
 */
export function createGeminiProvider(config: GeminiAdapterConfig): ModelProvider {
  return new GeminiProvider(config);
}

/**
 * Creates a Gemini provider with AI Studio defaults
 */
export function createGeminiStudioProvider(
  apiKey: string,
  options?: Partial<GeminiAdapterConfig>
): ModelProvider {
  return createGeminiProvider({
    apiKey,
    providerId: 'gemini',
    providerName: 'Google Gemini',
    baseUrl: DEFAULT_BASE_URL,
    defaultModel: DEFAULT_MODEL,
    useVertexAI: false,
    ...options,
  });
}

/**
 * Creates a Gemini provider with Vertex AI configuration
 */
export function createVertexAIGeminiProvider(
  accessToken: string,
  projectId: string,
  options?: Partial<GeminiAdapterConfig> & { region?: string }
): ModelProvider {
  const region = options?.region ?? 'us-central1';
  return createGeminiProvider({
    apiKey: accessToken,
    providerId: 'vertexai-gemini',
    providerName: 'Vertex AI Gemini',
    baseUrl: `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google`,
    useVertexAI: true,
    projectId,
    region,
    ...options,
  });
}
