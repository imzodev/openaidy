/**
 * Configuration schema for the providers section
 *
 * Defines the schema for provider configuration including
 * OpenAI-compatible, Anthropic, and Gemini providers.
 */

import type { SectionSchema, FieldSchema } from '../schema';

/**
 * Common provider fields shared across all vendor families
 */
const commonProviderFields: Record<string, FieldSchema> = {
  id: {
    type: 'string',
    key: 'id',
    label: 'Provider ID',
    required: true,
    description: 'Unique identifier for this provider',
    placeholder: 'e.g., openai, anthropic',
    helpText:
      'Use lowercase letters, numbers, and hyphens. This ID is used to reference the provider in agents and defaults.',
  },
  name: {
    type: 'string',
    key: 'name',
    label: 'Display Name',
    required: true,
    description: 'Human-readable name for this provider',
    placeholder: 'e.g., OpenAI, Anthropic',
  },
  enabled: {
    type: 'boolean',
    key: 'enabled',
    label: 'Enabled',
    defaultValue: true,
    description: 'Enable or disable this provider',
    helpText: 'Disabled providers are ignored during provider selection.',
  },
  baseUrl: {
    type: 'string',
    key: 'baseUrl',
    label: 'Base URL',
    description: 'API base URL (optional for some providers)',
    placeholder: 'e.g., https://api.openai.com/v1',
    helpText: 'The base URL for the API. Leave empty to use the default.',
  },
  apiKeyEnv: {
    type: 'string',
    key: 'apiKeyEnv',
    label: 'API Key Environment Variable',
    description: 'Name of the environment variable containing the API key',
    placeholder: 'e.g., OPENAI_API_KEY',
    helpText:
      'The app will read the API key from this environment variable. Never hardcode API keys in the config file.',
    visibleWhen: { field: 'enabled', equals: true },
  },
  defaultModel: {
    type: 'string',
    key: 'defaultModel',
    label: 'Default Model',
    description: 'Default model ID for this provider',
    placeholder: 'e.g., gpt-4o-mini',
  },
};

/**
 * OpenAI-compatible specific fields
 */
const openaiCompatibleFields: Record<string, FieldSchema> = {
  chatModel: {
    type: 'string',
    key: 'chatModel',
    label: 'Chat Model',
    description: 'Model to use for chat completions',
    placeholder: 'e.g., gpt-4o-mini',
  },
  enableTools: {
    type: 'boolean',
    key: 'enableTools',
    label: 'Enable Tool Calls',
    defaultValue: true,
    description: 'Enable function/tool calling support',
  },
  enableVision: {
    type: 'boolean',
    key: 'enableVision',
    label: 'Enable Vision',
    defaultValue: false,
    description: 'Enable image understanding support',
  },
  enableStreaming: {
    type: 'boolean',
    key: 'enableStreaming',
    label: 'Enable Streaming',
    defaultValue: true,
    description: 'Enable streaming responses',
  },
  defaultTemperature: {
    type: 'number',
    key: 'defaultTemperature',
    label: 'Default Temperature',
    defaultValue: 0.7,
    min: 0,
    max: 2,
    step: 0.1,
    description: 'Default sampling temperature (0-2)',
    helpText:
      'Higher values make output more random, lower values make it more deterministic.',
  },
  defaultMaxTokens: {
    type: 'number',
    key: 'defaultMaxTokens',
    label: 'Default Max Tokens',
    defaultValue: 4096,
    min: 1,
    description: 'Default maximum tokens in response',
  },
};

/**
 * Anthropic specific fields
 */
const anthropicFields: Record<string, FieldSchema> = {
  apiVersion: {
    type: 'string',
    key: 'apiVersion',
    label: 'API Version',
    defaultValue: '2023-06-01',
    description: 'Anthropic API version',
    helpText: 'The API version to use for Anthropic requests.',
  },
  messagesModel: {
    type: 'string',
    key: 'messagesModel',
    label: 'Messages Model',
    description: 'Model to use for messages API',
    placeholder: 'e.g., claude-3-opus',
  },
  enableExtendedThinking: {
    type: 'boolean',
    key: 'enableExtendedThinking',
    label: 'Enable Extended Thinking',
    defaultValue: false,
    description: 'Enable extended thinking mode',
    helpText: 'Allows Claude to think through complex problems step by step.',
  },
  maxThinkingTokens: {
    type: 'number',
    key: 'maxThinkingTokens',
    label: 'Max Thinking Tokens',
    min: 1,
    description: 'Maximum tokens for extended thinking',
    visibleWhen: { field: 'enableExtendedThinking', equals: true },
  },
  enableTools: {
    type: 'boolean',
    key: 'enableTools',
    label: 'Enable Tool Calls',
    defaultValue: true,
    description: 'Enable function/tool calling support',
  },
  enableVision: {
    type: 'boolean',
    key: 'enableVision',
    label: 'Enable Vision',
    defaultValue: true,
    description: 'Enable image understanding support',
  },
  enableStreaming: {
    type: 'boolean',
    key: 'enableStreaming',
    label: 'Enable Streaming',
    defaultValue: true,
    description: 'Enable streaming responses',
  },
  defaultMaxTokens: {
    type: 'number',
    key: 'defaultMaxTokens',
    label: 'Default Max Tokens',
    defaultValue: 4096,
    min: 1,
    description: 'Default maximum tokens in response',
  },
  defaultTemperature: {
    type: 'number',
    key: 'defaultTemperature',
    label: 'Default Temperature',
    defaultValue: 0.7,
    min: 0,
    max: 1,
    step: 0.1,
    description: 'Default sampling temperature (0-1)',
    helpText:
      'Higher values make output more random, lower values make it more deterministic.',
  },
};

/**
 * Gemini specific fields
 */
const geminiFields: Record<string, FieldSchema> = {
  projectId: {
    type: 'string',
    key: 'projectId',
    label: 'Google Cloud Project ID',
    description: 'GCP project ID for Vertex AI',
    helpText: 'Required when using Vertex AI instead of the Gemini API.',
  },
  region: {
    type: 'string',
    key: 'region',
    label: 'Region',
    defaultValue: 'us-central1',
    description: 'GCP region for Vertex AI',
  },
  useVertexAI: {
    type: 'boolean',
    key: 'useVertexAI',
    label: 'Use Vertex AI',
    defaultValue: false,
    description: 'Use Vertex AI instead of Gemini API',
  },
  embeddingModel: {
    type: 'string',
    key: 'embeddingModel',
    label: 'Embedding Model',
    defaultValue: 'text-embedding-004',
    description: 'Model for text embeddings',
  },
  enableTools: {
    type: 'boolean',
    key: 'enableTools',
    label: 'Enable Tool Calls',
    defaultValue: true,
    description: 'Enable function/tool calling support',
  },
  enableVision: {
    type: 'boolean',
    key: 'enableVision',
    label: 'Enable Vision',
    defaultValue: true,
    description: 'Enable image understanding support',
  },
  enableStreaming: {
    type: 'boolean',
    key: 'enableStreaming',
    label: 'Enable Streaming',
    defaultValue: true,
    description: 'Enable streaming responses',
  },
  defaultTemperature: {
    type: 'number',
    key: 'defaultTemperature',
    label: 'Default Temperature',
    defaultValue: 0.7,
    min: 0,
    max: 2,
    step: 0.1,
    description: 'Default sampling temperature (0-2)',
  },
  defaultMaxTokens: {
    type: 'number',
    key: 'defaultMaxTokens',
    label: 'Default Max Tokens',
    defaultValue: 8192,
    min: 1,
    description: 'Default maximum tokens in response',
  },
};

/**
 * Model item schema - fields for a single model entry within a provider
 */
const modelItemSchema: FieldSchema = {
  type: 'object',
  key: 'model',
  label: 'Model',
  properties: {
    id: {
      type: 'string',
      key: 'id',
      label: 'Model ID',
      required: true,
      description: 'Unique model identifier (used in agent config)',
      placeholder: 'e.g., gpt-4o-mini',
      helpText: 'Must match the model ID used by the provider API.',
    },
    name: {
      type: 'string',
      key: 'name',
      label: 'Display Name',
      required: true,
      description: 'Human-readable name for this model',
      placeholder: 'e.g., GPT-4o Mini',
    },
    enabled: {
      type: 'boolean',
      key: 'enabled',
      label: 'Enabled',
      defaultValue: true,
      description: 'Enable or disable this model',
    },
    contextWindow: {
      type: 'number',
      key: 'contextWindow',
      label: 'Context Window',
      description: 'Maximum context length in tokens',
      placeholder: 'e.g., 128000',
      min: 1,
    },
    maxOutputTokens: {
      type: 'number',
      key: 'maxOutputTokens',
      label: 'Max Output Tokens',
      description: 'Maximum tokens the model can generate per response',
      placeholder: 'e.g., 4096',
      min: 1,
    },
  },
};

/**
 * Provider schema with discriminated union based on vendorFamily
 */
const providerSchema: FieldSchema = {
  type: 'object',
  key: 'providers',
  label: 'Provider',
  properties: {
    ...commonProviderFields,
    vendorFamily: {
      type: 'select',
      key: 'vendorFamily',
      label: 'Vendor Family',
      required: true,
      description: 'The type of API this provider uses',
      options: [
        {
          value: 'openai-compatible',
          label: 'OpenAI Compatible',
          description: 'OpenAI, Azure OpenAI, and compatible APIs',
        },
        {
          value: 'anthropic',
          label: 'Anthropic',
          description: 'Claude and Anthropic APIs',
        },
        {
          value: 'gemini',
          label: 'Google Gemini',
          description: 'Google Gemini and Vertex AI',
        },
      ],
    },
    models: {
      type: 'array',
      key: 'models',
      label: 'Model',
      description: 'Models available from this provider',
      minItems: 1,
      itemSchema: modelItemSchema,
    },
  },
};

/**
 * Get the providers section schema
 */
export function getProvidersSectionSchema(): SectionSchema {
  return {
    id: 'providers',
    fields: [
      {
        type: 'array',
        key: 'providers',
        label: 'Provider',
        minItems: 1,
        itemSchema: providerSchema,
      },
    ],
  };
}

/**
 * Get vendor-specific fields for a provider
 */
export function getVendorSpecificFields(
  vendorFamily: string,
): Record<string, FieldSchema> {
  switch (vendorFamily) {
    case 'openai-compatible':
      return openaiCompatibleFields;
    case 'anthropic':
      return anthropicFields;
    case 'gemini':
      return geminiFields;
    default:
      return {};
  }
}
