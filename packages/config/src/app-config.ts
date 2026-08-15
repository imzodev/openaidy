import { z } from 'zod';
import { httpTimeoutSchema, retrySchema, vendorFamilySchema } from './provider';

// ============================================================================
// Shared secret value schema (used by channels and MCP servers)
// ============================================================================

/**
 * A single secret value. A plain string is the legacy shape (still accepted
 * for backward compatibility with existing configs); the structured object
 * form records whether the value is a `${VAR}`/env-var reference or an inline
 * secret. Inline values are stored encrypted at rest — see
 * `apps/server/src/mcp/secret-crypto.ts` — the `value` here is the
 * `enc:v1:...` ciphertext, never the plaintext secret.
 */
export const mcpSecretValueSchema = z.union([
  z.string(),
  z.object({
    kind: z.enum(['env', 'inline']),
    value: z.string(),
  }),
]);

export type McpSecretValue = z.infer<typeof mcpSecretValueSchema>;

// ============================================================================
// Channel Configuration
// ============================================================================

/**
 * Strip `<think>...</think>`-style reasoning blocks from the agent's reply
 * text before sending it to a channel. Shared across every channel type
 * (see `stripThinkingSchema`'s usage below) — a new channel schema (e.g.
 * Telegram) picks up the same field and behavior by reusing this constant.
 *
 * Only covers reasoning embedded inline in the reply text itself: some
 * models/routing paths emit `<think>...</think>` directly in the message
 * content rather than in a separate structured field. When a provider
 * instead returns reasoning via a separate field (e.g. `reasoning_content`),
 * that's already tracked apart from `content` and never reaches the channel
 * reply in the first place — nothing to strip there.
 *
 * Defaults to `true`: channels are for regular human chat, so raw
 * chain-of-thought is noise there by default.
 */
const stripThinkingSchema = z.boolean().default(true);

export const whatsappChannelConfigSchema = z.object({
  type: z.literal('whatsapp'),
  id: z.string().min(1),
  agentId: z.string().min(1),
  allowlist: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
  stripThinking: stripThinkingSchema,
});

/**
 * Discord channel. Authenticates with a bot token (no QR). The token is a
 * secret value (env reference or inline-encrypted) stored via
 * {@link mcpSecretValueSchema}. Trigger rules: DMs (optionally restricted to
 * `dmAllowlist` user IDs), `@mentions` in servers when `respondToMentions`,
 * and all messages in the server channels listed in `channelAllowlist`.
 */
export const discordChannelConfigSchema = z.object({
  type: z.literal('discord'),
  id: z.string().min(1),
  agentId: z.string().min(1),
  botToken: mcpSecretValueSchema,
  /** Discord user IDs allowed to DM the bot; empty/absent = allow all DMs. */
  dmAllowlist: z.array(z.string()).optional(),
  /** Server channel IDs the bot responds to (all messages in them). */
  channelAllowlist: z.array(z.string()).optional(),
  /** In server channels, reply when the bot is @mentioned. */
  respondToMentions: z.boolean().default(true),
  enabled: z.boolean().default(true),
  stripThinking: stripThinkingSchema,
});

export const channelConfigSchema = z.discriminatedUnion('type', [
  whatsappChannelConfigSchema,
  discordChannelConfigSchema,
  // Future channels added here: telegram, slack, etc.
  // Adding a new channel = add its schema to this union. Zero other changes needed.
]);

export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelConfigSchema>;
export type DiscordChannelConfig = z.infer<typeof discordChannelConfigSchema>;
export type ChannelConfig = z.infer<typeof channelConfigSchema>;

// ============================================================================
// MCP Server Configuration
// ============================================================================

/**
 * MCP server transport type - stdio for local processes, http for remote servers
 *
 * NOTE: HTTP transport is not yet implemented. Use stdio for now.
 * See: https://github.com/imzodev/openaidy/issues/200
 */
export const mcpServerTransportSchema = z.enum(['stdio', 'http']);

/**
 * MCP server configuration schema
 *
 * Supports two transport types:
 * - stdio: Local process communication (e.g., npx @modelcontextprotocol/server-filesystem)
 * - http: Remote HTTP server communication (NOT YET IMPLEMENTED - see issue #200)
 */
export const mcpServerConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    transport: mcpServerTransportSchema,
    // stdio transport fields
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(mcpSecretValueSchema).optional(),
    // http transport fields (NOT YET IMPLEMENTED)
    url: z.string().url().optional(),
    headers: z.record(mcpSecretValueSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.transport === 'stdio') {
        return !!data.command;
      }
      if (data.transport === 'http') {
        return !!data.url;
      }
      return false;
    },
    {
      message: 'stdio transport requires command, http transport requires url',
    },
  );

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type McpServerTransport = z.infer<typeof mcpServerTransportSchema>;

/**
 * MCP Server runtime status (returned by API)
 */
export type McpServer = {
  id: string;
  name?: string;
  connected: boolean;
  tools: Array<{
    name: string;
    description?: string;
  }>;
};

// ============================================================================
// Provider Configuration
// ============================================================================

const providerCapabilitySchema = z.enum([
  'text_generation',
  'streaming',
  'tool_calls',
  'vision',
  'audio_input',
  'audio_output',
  'embedding',
]);

export const appModelConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  description: z.string().optional(),
  capabilities: z
    .array(providerCapabilitySchema)
    .optional()
    .default(['text_generation']),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const appProviderBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  timeout: httpTimeoutSchema.optional(),
  retry: retrySchema.optional(),
  headers: z.record(z.string()).optional(),
  priority: z.number().int().min(0).max(100).optional().default(50),
  metadata: z.record(z.unknown()).optional(),
  models: z.array(appModelConfigSchema).min(1),
});

export const appOpenAIProviderConfigSchema = appProviderBaseSchema.extend({
  vendorFamily: z.literal('openai-compatible'),
  chatModel: z.string().optional(),
  embeddingModel: z.string().optional(),
  audioModel: z.string().optional(),
  imageModel: z.string().optional(),
  useResponsesApi: z.boolean().optional().default(false),
  enableTools: z.boolean().optional().default(true),
  enableVision: z.boolean().optional().default(false),
  enableStreaming: z.boolean().optional().default(true),
  defaultTemperature: z.number().min(0).max(2).optional().default(0.7),
  defaultMaxTokens: z.number().int().positive().optional().default(4096),
});

export const appAnthropicProviderConfigSchema = appProviderBaseSchema.extend({
  vendorFamily: z.literal('anthropic'),
  apiVersion: z.string().optional().default('2023-06-01'),
  messagesModel: z.string().optional(),
  betas: z.array(z.string()).optional(),
  enableExtendedThinking: z.boolean().optional().default(false),
  maxThinkingTokens: z.number().int().positive().optional(),
  enableTools: z.boolean().optional().default(true),
  enableVision: z.boolean().optional().default(true),
  enableStreaming: z.boolean().optional().default(true),
  defaultMaxTokens: z.number().int().positive().optional().default(4096),
  defaultTemperature: z.number().min(0).max(1).optional().default(0.7),
  systemPrompt: z.string().optional(),
});

export const appGeminiProviderConfigSchema = appProviderBaseSchema.extend({
  vendorFamily: z.literal('gemini'),
  projectId: z.string().optional(),
  region: z.string().optional().default('us-central1'),
  useVertexAI: z.boolean().optional().default(false),
  embeddingModel: z.string().optional().default('text-embedding-004'),
  safetySettings: z
    .array(
      z.object({
        category: z.enum([
          'HARM_CATEGORY_HARASSMENT',
          'HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'HARM_CATEGORY_DANGEROUS_CONTENT',
          'HARM_CATEGORY_CIVIC_INTEGRITY',
        ]),
        threshold: z.enum([
          'BLOCK_NONE',
          'BLOCK_LOW_AND_ABOVE',
          'BLOCK_MEDIUM_AND_ABOVE',
          'BLOCK_ONLY_HIGH',
        ]),
      }),
    )
    .optional(),
  generationConfig: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      topK: z.number().int().positive().optional(),
      candidateCount: z.number().int().min(1).max(8).optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      stopSequences: z.array(z.string()).optional(),
      responseMimeType: z.enum(['text/plain', 'application/json']).optional(),
    })
    .optional(),
  enableTools: z.boolean().optional().default(true),
  enableVision: z.boolean().optional().default(true),
  enableAudioInput: z.boolean().optional().default(true),
  enableStreaming: z.boolean().optional().default(true),
  defaultTemperature: z.number().min(0).max(2).optional().default(0.7),
  defaultMaxTokens: z.number().int().positive().optional().default(8192),
  systemInstruction: z.string().optional(),
});

export const appProviderConfigSchema = z.discriminatedUnion('vendorFamily', [
  appOpenAIProviderConfigSchema,
  appAnthropicProviderConfigSchema,
  appGeminiProviderConfigSchema,
]);

const appAgentWorkspacePermissionSchema = z.object({
  read: z.boolean().default(true),
  write: z.boolean().default(false),
  delete: z.boolean().default(false),
  list: z.boolean().default(true),
});

const appAgentWorkspaceSchema = z.object({
  path: z.string().min(1),
  permissions: appAgentWorkspacePermissionSchema.optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const appAgentWorkspaceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultPermissions: appAgentWorkspacePermissionSchema.optional(),
  workspaces: z.array(appAgentWorkspaceSchema).default([]),
});

const appAgentMcpServerRefSchema = z.object({
  id: z.string().min(1),
  tools: z.array(z.string()).optional(),
});

export const appAgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini". Optional so a
  // fresh install can ship an agent with no model; it inherits the config
  // default (which onboarding sets once the first provider is connected).
  model: z.string().min(1).optional(),
  tools: z.array(z.string()).optional(),
  mcpServers: z.array(appAgentMcpServerRefSchema).optional(),
  tags: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  workspace: appAgentWorkspaceConfigSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().optional().default(1),
});

export const appDefaultsSchema = z.object({
  // providerId/modelId are optional to represent an "unconfigured" install
  // (no providers yet). Once the first provider is connected via onboarding,
  // these are set. agentId is always required (there is always >=1 agent).
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  agentId: z.string().min(1),
});

/**
 * Single source of truth for the execution config defaults below. Consumers
 * that need a fallback outside a parsed config (e.g. `TaskExecution`'s
 * constructor default when no `getExecutionConfig` getter is injected) import
 * this instead of hand-copying the literal, so a schema default change can't
 * silently drift out of sync with the fallback.
 */
export const DEFAULT_EXECUTION_CONFIG = {
  maxRetries: 5,
  depContextPerItemChars: 2000,
  depContextTotalChars: 8000,
} as const;

/**
 * Task/subtask execution tuning. Governs subtask retry behavior and how much
 * of a completed dependency subtask's result gets carried into a downstream
 * subtask's prompt.
 */
export const executionConfigSchema = z.object({
  /** Max retry attempts for a failed subtask before it's marked failed. */
  maxRetries: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(DEFAULT_EXECUTION_CONFIG.maxRetries),
  /** Per-dependency cap (chars) on how much of its result is carried forward. */
  depContextPerItemChars: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .optional()
    .default(DEFAULT_EXECUTION_CONFIG.depContextPerItemChars),
  /** Total cap (chars) across all dependencies carried into one subtask. */
  depContextTotalChars: z
    .number()
    .int()
    .min(100)
    .max(200000)
    .optional()
    .default(DEFAULT_EXECUTION_CONFIG.depContextTotalChars),
});

export type ExecutionConfig = z.infer<typeof executionConfigSchema>;

/**
 * Per-model pricing override (USD per 1,000 tokens). Merged over the
 * built-in MODEL_PRICING reference table so users can add custom providers
 * or correct outdated rates. Keyed by model id.
 */
export const modelPricingSchema = z.object({
  promptPer1k: z.number().nonnegative(),
  completionPer1k: z.number().nonnegative(),
  cacheReadPer1k: z.number().nonnegative().optional(),
  cacheCreationPer1k: z.number().nonnegative().optional(),
});

export const appConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    defaults: appDefaultsSchema,
    // May be empty on a fresh install; providers are added via onboarding.
    providers: z.array(appProviderConfigSchema),
    agents: z.array(appAgentConfigSchema).min(1),
    mcpServers: z.array(mcpServerConfigSchema).optional(),
    channels: z.array(channelConfigSchema).optional(),
    /** Optional per-model pricing overrides for cost estimation */
    modelPricing: z.record(z.string(), modelPricingSchema).optional(),
    /** Task/subtask execution tuning (retries, dependency-context limits) */
    execution: executionConfigSchema.optional().default({}),
  })
  .superRefine((config, ctx) => {
    const providerIds = new Set<string>();
    const providerModels = new Map<string, Set<string>>();
    const providerEnabledModels = new Map<string, Set<string>>();

    config.providers.forEach((provider, providerIndex) => {
      if (providerIds.has(provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'id'],
          message: `Duplicate provider id "${provider.id}"`,
        });
      }
      providerIds.add(provider.id);

      const modelIds = new Set<string>();
      const enabledModelIds = new Set<string>();
      provider.models.forEach((model, modelIndex) => {
        if (modelIds.has(model.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'models', modelIndex, 'id'],
            message: `Duplicate model id "${model.id}" in provider "${provider.id}"`,
          });
        }
        modelIds.add(model.id);
        if (model.enabled !== false) {
          enabledModelIds.add(model.id);
        }
      });
      providerModels.set(provider.id, modelIds);
      providerEnabledModels.set(provider.id, enabledModelIds);

      if (provider.defaultModel && !modelIds.has(provider.defaultModel)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'defaultModel'],
          message: `Default model "${provider.defaultModel}" is not defined in provider "${provider.id}"`,
        });
      } else if (
        provider.defaultModel &&
        !enabledModelIds.has(provider.defaultModel)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'defaultModel'],
          message: `Default model "${provider.defaultModel}" is disabled in provider "${provider.id}"`,
        });
      }
    });

    const agentIds = new Set<string>();
    const enabledAgentIds = new Set<string>();

    config.agents.forEach((agent, agentIndex) => {
      if (agentIds.has(agent.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['agents', agentIndex, 'id'],
          message: `Duplicate agent id "${agent.id}"`,
        });
      }
      agentIds.add(agent.id);
      if (agent.enabled) {
        enabledAgentIds.add(agent.id);
      }

      // Validate model format "providerId/modelId" only when a model is set.
      // A model-less agent inherits the config default at runtime, so there is
      // nothing to validate here (and it must not fail on an empty install).
      if (agent.model !== undefined) {
        const modelParts = agent.model.split('/');
        if (modelParts.length !== 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['agents', agentIndex, 'model'],
            message: `Invalid model format "${agent.model}". Expected "providerId/modelId"`,
          });
        } else {
          const providerId = modelParts[0]!;
          const modelId = modelParts[1]!;
          if (!providerIds.has(providerId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['agents', agentIndex, 'model'],
              message: `Unknown provider "${providerId}" for agent "${agent.id}"`,
            });
          } else {
            const models = providerModels.get(providerId);
            if (!models?.has(modelId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['agents', agentIndex, 'model'],
                message: `Unknown model "${modelId}" for provider "${providerId}"`,
              });
            } else if (!providerEnabledModels.get(providerId)?.has(modelId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['agents', agentIndex, 'model'],
                message: `Model "${modelId}" is disabled in provider "${providerId}"`,
              });
            }
          }
        }
      }
    });

    // Only validate the default provider/model when they are set. An
    // unconfigured install leaves both undefined until onboarding connects a
    // provider. If one is set, both must be set and must resolve.
    const { providerId: defaultProviderId, modelId: defaultModelId } =
      config.defaults;
    if (defaultProviderId !== undefined || defaultModelId !== undefined) {
      if (defaultProviderId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['defaults', 'providerId'],
          message: 'A default provider is required when a default model is set',
        });
      } else if (defaultModelId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['defaults', 'modelId'],
          message: 'A default model is required when a default provider is set',
        });
      } else {
        if (!providerIds.has(defaultProviderId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['defaults', 'providerId'],
            message: `Unknown default provider "${defaultProviderId}"`,
          });
        }

        const defaultModels = providerModels.get(defaultProviderId);
        if (!defaultModels?.has(defaultModelId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['defaults', 'modelId'],
            message: `Unknown default model "${defaultModelId}" for provider "${defaultProviderId}"`,
          });
        } else if (
          !providerEnabledModels.get(defaultProviderId)?.has(defaultModelId)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['defaults', 'modelId'],
            message: `Default model "${defaultModelId}" is disabled in provider "${defaultProviderId}"`,
          });
        }
      }
    }

    if (!agentIds.has(config.defaults.agentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaults', 'agentId'],
        message: `Unknown default agent "${config.defaults.agentId}"`,
      });
    }

    // No "at least one enabled provider" check: a fresh install ships with
    // zero providers and the user connects one via onboarding. When providers
    // ARE present but all disabled, that is still a valid (unusable) state and
    // is surfaced to the user through the provider connection UI instead.

    if (enabledAgentIds.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agents'],
        message: 'At least one agent must be enabled',
      });
    }

    // Validate MCP server IDs are unique
    if (config.mcpServers) {
      const mcpServerIds = new Set<string>();
      config.mcpServers.forEach((server, serverIndex) => {
        if (mcpServerIds.has(server.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mcpServers', serverIndex, 'id'],
            message: `Duplicate MCP server id "${server.id}"`,
          });
        }
        mcpServerIds.add(server.id);
      });
    }

    // Validate channel IDs are unique
    if (config.channels) {
      const channelIds = new Set<string>();
      config.channels.forEach((channel, index) => {
        if (channelIds.has(channel.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['channels', index, 'id'],
            message: `Duplicate channel id "${channel.id}"`,
          });
        }
        channelIds.add(channel.id);
      });
    }
  });

export type OpenAidyAppConfig = z.infer<typeof appConfigSchema>;
export type AppDefaults = z.infer<typeof appDefaultsSchema>;
export type AppProviderConfig = z.infer<typeof appProviderConfigSchema>;
export type AppModelConfig = z.infer<typeof appModelConfigSchema>;
export type AppAgentConfig = z.infer<typeof appAgentConfigSchema>;
export type AppVendorFamily = z.infer<typeof vendorFamilySchema>;

export function validateAppConfig(
  config: unknown,
): { ok: true; value: OpenAidyAppConfig } | { ok: false; error: string } {
  const result = appConfigSchema.safeParse(config);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  return {
    ok: false,
    error: result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  };
}
