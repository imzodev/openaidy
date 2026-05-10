/**
 * Provider Preset - pre-configured popular providers with default models
 */

export type ProviderPresetId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'deepseek';

export type ModelPreset = {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
};

export type ProviderPreset = {
  id: ProviderPresetId;
  name: string;
  vendorFamily: 'openai-compatible' | 'anthropic' | 'gemini';
  baseUrl: string;
  models: ModelPreset[];
  recommendedModel: string;
  websiteUrl: string;
  documentationUrl: string;
  icon: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    websiteUrl: 'https://openai.com',
    documentationUrl: 'https://platform.openai.com/docs/api-reference',
    recommendedModel: 'gpt-4o-mini',
    icon: 'bi-robot',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Strong reasoning and vision',
        contextWindow: 128000,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast and affordable',
        contextWindow: 128000,
      },
      {
        id: 'o4-mini',
        name: 'o4 Mini',
        description: 'Reasoning model',
        contextWindow: 200000,
      },
      {
        id: 'o3',
        name: 'o3',
        description: 'Advanced reasoning',
        contextWindow: 200000,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    vendorFamily: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    websiteUrl: 'https://anthropic.com',
    documentationUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    recommendedModel: 'claude-sonnet-4-6',
    icon: 'bi-brain',
    models: [
      {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        description: 'Most capable for complex tasks',
        contextWindow: 200000,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        description: 'Best speed/intelligence balance',
        contextWindow: 200000,
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        description: 'Fast and affordable',
        contextWindow: 200000,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    vendorFamily: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    websiteUrl: 'https://ai.google.dev',
    documentationUrl:
      'https://cloud.google.com/alloydocs/ai-platform-key-features',
    recommendedModel: 'gemini-2.0-flash',
    icon: 'bi-google',
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Most capable Gemini',
        contextWindow: 1000000,
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Fast and versatile',
        contextWindow: 1000000,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Long context understanding',
        contextWindow: 2000000,
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    websiteUrl: 'https://console.groq.com',
    documentationUrl: 'https://console.groq.com/docs/models',
    recommendedModel: 'llama-3.3-70b-versatile',
    icon: 'bi-lightning-charge',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B',
        description: 'Fast open model',
        contextWindow: 131072,
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B',
        description: 'Very fast, great price',
        contextWindow: 131072,
      },
      {
        id: 'qwen3-32b',
        name: 'Qwen3 32B',
        description: 'Fast reasoning',
        contextWindow: 131072,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    websiteUrl: 'https://platform.deepseek.com',
    documentationUrl: 'https://platform.deepseek.com/api-docs',
    recommendedModel: 'deepseek-v4-flash',
    icon: 'bi-database',
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        description: 'Most capable',
        contextWindow: 640000,
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        description: 'Fast and affordable',
        contextWindow: 640000,
      },
    ],
  },
];
