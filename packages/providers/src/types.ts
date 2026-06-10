/**
 * Provider Profile Types and ProviderProfile class
 *
 * This module defines the ProviderProfile dataclass — a declarative,
 * pure-data description of a provider with overridable hook methods.
 * No SDK dependencies.
 */

import { z } from 'zod';

import type {
  BuildRequestHook,
  OnStreamChunkHook,
  PrepareMessagesHook,
  HookContext,
  StreamChunk,
} from './hooks';

// ── Zod Schema ────────────────────────────────────────────────────────────────

export const providerProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    baseUrl: z
      .string()
      .url()
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
    auth: z
      .object({
        type: z.enum(['api_key', 'oauth', 'device_code', 'aws_sdk']),
        envVars: z.array(z.string()).default([]),
      })
      .optional(),
    aliases: z.array(z.string()).default([]),
    apiMode: z
      .enum(['openai-compatible', 'anthropic-messages', 'gemini', 'custom'])
      .default('openai-compatible'),
    defaultModel: z.string().default('').optional(),
    models: z
      .array(
        z.object({
          id: z.string(),
          name: z.string().default('').optional(),
          capabilities: z
            .array(
              z.enum([
                'text_generation',
                'streaming',
                'tool_calls',
                'vision',
                'audio_input',
                'audio_output',
                'embedding',
              ]),
            )
            .default(['text_generation'] as const),
          contextWindow: z.number().int().positive().default(0).optional(),
          maxOutputTokens: z.number().int().positive().default(0).optional(),
        }),
      )
      .default([] as const),
    displayName: z.string().default('').optional(),
    description: z.string().default('').optional(),
    signupUrl: z
      .string()
      .transform((v) => (v === '' ? undefined : v))
      .pipe(z.string().url().optional())
      .optional(),
    vendorFamily: z
      .enum(['openai-compatible', 'anthropic', 'gemini'])
      .optional(),
    defaultHeaders: z.record(z.string()).default({}),
    fixedTemperature: z.number().min(0).max(2).default(0).optional(),
    defaultMaxTokens: z.number().int().positive().default(0).optional(),
    defaultAuxModel: z.string().default('').optional(),
    supportsHealthCheck: z.boolean().default(true),
  })
  .transform((data) => {
    // Normalize: convert '' to undefined for optional string fields
    // This ensures exactOptionalPropertyTypes compatibility
    return {
      ...data,
      baseUrl: data.baseUrl === '' ? undefined : data.baseUrl,
      defaultModel: data.defaultModel === '' ? undefined : data.defaultModel,
      displayName: data.displayName === '' ? undefined : data.displayName,
      description: data.description === '' ? undefined : data.description,
      signupUrl: data.signupUrl === '' ? undefined : data.signupUrl,
      defaultAuxModel:
        data.defaultAuxModel === '' ? undefined : data.defaultAuxModel,
    };
  });

export type ProviderProfileData = z.infer<typeof providerProfileSchema>;
/** Input type — same as ProviderProfileData but all fields optional with schema defaults */
export type ProviderProfileInput = z.input<typeof providerProfileSchema>;

// ── ProviderProfile class ─────────────────────────────────────────────────────

/**
 * Declarative provider profile.
 *
 * All provider-specific behavior is expressed as data + overridable hook
 * methods, never as if/else branches inside the adapter.
 *
 * Subclass to add custom behavior, or use ProviderProfile.create() with
 * plain data objects.
 */
export class ProviderProfile {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: {
    type: 'api_key' | 'oauth' | 'device_code' | 'aws_sdk';
    envVars: string[];
  };
  readonly aliases: readonly string[];
  readonly apiMode:
    | 'openai-compatible'
    | 'anthropic-messages'
    | 'gemini'
    | 'custom';
  readonly defaultModel: string | undefined;
  readonly models: readonly {
    id: string;
    name?: string;
    capabilities: readonly string[];
    contextWindow?: number;
    maxOutputTokens?: number;
  }[];
  readonly displayName: string | undefined;
  readonly description: string | undefined;
  readonly signupUrl: string | undefined;
  readonly vendorFamily:
    | 'openai-compatible'
    | 'anthropic'
    | 'gemini'
    | undefined;
  readonly defaultHeaders: Record<string, string>;
  readonly fixedTemperature: number | undefined;
  readonly defaultMaxTokens: number | undefined;
  readonly defaultAuxModel: string | undefined;
  readonly supportsHealthCheck: boolean;

  protected _buildRequestHooks: BuildRequestHook[] = [];
  protected _onStreamChunkHooks: OnStreamChunkHook[] = [];
  protected _prepareMessagesHooks: PrepareMessagesHook[] = [];

  constructor(data: ProviderProfileInput) {
    const parsed = providerProfileSchema.parse(data) as ProviderProfileData;
    this.id = parsed.id;
    this.name = parsed.name;
    this.baseUrl = parsed.baseUrl ?? '';
    this.auth = parsed.auth ?? { type: 'api_key', envVars: [] };
    this.aliases = parsed.aliases;
    this.apiMode = parsed.apiMode;
    this.defaultModel = parsed.defaultModel;
    type ModelEntry = {
      id: string;
      name?: string;
      capabilities: readonly string[];
      contextWindow?: number;
      maxOutputTokens?: number;
    };

    this.models = parsed.models as readonly ModelEntry[];
    this.displayName = parsed.displayName;
    this.description = parsed.description;
    this.signupUrl = parsed.signupUrl;
    this.vendorFamily = parsed.vendorFamily;
    this.defaultHeaders = parsed.defaultHeaders;
    this.fixedTemperature = parsed.fixedTemperature;
    this.defaultMaxTokens = parsed.defaultMaxTokens;
    this.defaultAuxModel = parsed.defaultAuxModel;
    this.supportsHealthCheck = parsed.supportsHealthCheck;
  }

  static create(data: ProviderProfileInput): ProviderProfile {
    return new ProviderProfile(data);
  }

  // ── Hook accessors ──────────────────────────────────────────────────────────

  get buildRequestHooks(): readonly BuildRequestHook[] {
    return this._buildRequestHooks;
  }

  get onStreamChunkHooks(): readonly OnStreamChunkHook[] {
    return this._onStreamChunkHooks;
  }

  get prepareMessagesHooks(): readonly PrepareMessagesHook[] {
    return this._prepareMessagesHooks;
  }

  // ── Overridable hook methods ────────────────────────────────────────────────

  /**
   * Build extra fields to merge into the outgoing request.
   * Return { extraBody, topLevel, headers } — adapter merges these appropriately.
   *
   * Override in a subclass. Default: all empty.
   */
  buildExtraBody(_context: HookContext): {
    extraBody: Record<string, unknown>;
    topLevel: Record<string, unknown>;
    headers: Record<string, string>;
  } {
    return { extraBody: {}, topLevel: {}, headers: {} };
  }

  /**
   * Called on each streamed chunk. Return modified chunk fields.
   * Used by DeepSeek/MiniMax to accumulate `reasoning_content`.
   *
   * Override in a subclass. Default: pass-through.
   */
  onStreamChunk(chunk: StreamChunk, _context: HookContext): StreamChunk {
    return chunk;
  }

  /**
   * Preprocess messages before sending to the API.
   * Used to inject system instructions or transform roles.
   *
   * Override in a subclass. Default: pass-through.
   */
  prepareMessages(messages: unknown[], _context: HookContext): unknown[] {
    return messages;
  }

  /**
   * Return per-model max tokens override.
   * Override in a subclass. Default: undefined.
   */
  getMaxTokens(_model?: string): number | undefined {
    return undefined;
  }

  /**
   * Return the resolved base URL (can include runtime overrides).
   * Override in a subclass. Default: returns this.baseUrl.
   */
  getBaseUrl(_context?: HookContext): string {
    return this.baseUrl;
  }

  /**
   * Return the model ID to use when none specified.
   * Default: this.defaultModel.
   */
  resolveModel(modelHint?: string): string | undefined {
    return modelHint ?? this.defaultModel;
  }

  // ── Connection Methods ────────────────────────────────────────────────────

  /**
   * Return the available authentication methods for this provider.
   * Override in subclass to define auth methods.
   */
  getAvailableAuthMethods(): import('@openaidy/shared-types').AuthMethod[] {
    return [{ type: 'api_key', label: 'API Key' }];
  }

  /**
   * Validate API key by making a health check call.
   * Override in subclass for provider-specific validation.
   */
  async validateApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return { valid: response.ok };
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  }

  /**
   * Return the OAuth authorization URL for this provider.
   * Override in subclass to provide provider-specific OAuth URL.
   */
  getOAuthAuthorizationUrl(_scopes?: string[]): string | undefined {
    return undefined;
  }

  /**
   * Exchange authorization code for tokens.
   * Override in subclass for provider-specific token exchange.
   */
  async exchangeOAuthCode(
    _code: string,
    _redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
  }> {
    return { accessToken: '', error: 'OAuth not supported' };
  }

  /**
   * Get device code info for CLI/desktop OAuth flows (RFC 8628).
   * Return undefined if provider doesn't support device code flow.
   */
  getDeviceCodeInfo():
    | import('@openaidy/shared-types').DeviceCodeResponse
    | undefined {
    return undefined;
  }

  /**
   * Poll for device code authorization completion.
   * Return { pending: true } while waiting, { accessToken } when complete,
   * or { error } when failed.
   */
  async pollDeviceCodeAuth(_deviceCode: string): Promise<{
    pending?: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
  }> {
    return { error: 'Device code flow not supported' };
  }

  /**
   * Get the signup/registration URL for this provider.
   */
  getSignupUrl(): string | undefined {
    return this.signupUrl;
  }

  /**
   * Get the icon identifier for this provider.
   */
  getIcon(): string {
    return `bi-${this.id}`;
  }
}
