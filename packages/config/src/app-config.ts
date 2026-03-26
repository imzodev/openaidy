import { z } from 'zod';
import { httpTimeoutSchema, retrySchema, vendorFamilySchema } from './provider';

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

export const appAgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  model: z.string().min(1), // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini"
  tools: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().optional().default(1),
});

export const appDefaultsSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  agentId: z.string().min(1),
});

export const appConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    defaults: appDefaultsSchema,
    providers: z.array(appProviderConfigSchema).min(1),
    agents: z.array(appAgentConfigSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const providerIds = new Set<string>();
    const enabledProviderIds = new Set<string>();
    const providerModels = new Map<string, Set<string>>();

    config.providers.forEach((provider, providerIndex) => {
      if (providerIds.has(provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'id'],
          message: `Duplicate provider id "${provider.id}"`,
        });
      }
      providerIds.add(provider.id);
      if (provider.enabled) {
        enabledProviderIds.add(provider.id);
      }

      const modelIds = new Set<string>();
      provider.models.forEach((model, modelIndex) => {
        if (modelIds.has(model.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'models', modelIndex, 'id'],
            message: `Duplicate model id "${model.id}" in provider "${provider.id}"`,
          });
        }
        modelIds.add(model.id);
      });
      providerModels.set(provider.id, modelIds);

      if (provider.defaultModel && !modelIds.has(provider.defaultModel)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'defaultModel'],
          message: `Default model "${provider.defaultModel}" is not defined in provider "${provider.id}"`,
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

      // Validate model format "providerId/modelId"
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
          }
        }
      }
    });

    if (!providerIds.has(config.defaults.providerId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaults', 'providerId'],
        message: `Unknown default provider "${config.defaults.providerId}"`,
      });
    }

    const defaultModels = providerModels.get(config.defaults.providerId);
    if (!defaultModels?.has(config.defaults.modelId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaults', 'modelId'],
        message: `Unknown default model "${config.defaults.modelId}" for provider "${config.defaults.providerId}"`,
      });
    }

    if (!agentIds.has(config.defaults.agentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaults', 'agentId'],
        message: `Unknown default agent "${config.defaults.agentId}"`,
      });
    }

    if (enabledProviderIds.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providers'],
        message: 'At least one provider must be enabled',
      });
    }

    if (enabledAgentIds.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agents'],
        message: 'At least one agent must be enabled',
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
