/**
 * Provider Preset - pre-configured popular providers with default models
 */

export type ProviderPresetId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'minimax'
  | 'opencode-go'
  | 'opencode-go-anthropic'
  | 'opencode-zen'
  | 'ollama'
  | 'lmstudio';

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
  /**
   * A local provider (e.g. Ollama, LM Studio) reachable at a localhost base
   * URL and requiring no API key. The UI skips the credential/connect dialog
   * for these and configures them directly (base URL + discovered models);
   * the adapter sends a placeholder key the local server ignores.
   */
  local?: boolean;
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
      {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        description: 'Latest flash (preview)',
        contextWindow: 1000000,
      },
      {
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash-Lite',
        description: 'High-volume, low-cost flash (larger free-tier limits)',
        contextWindow: 1048576,
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
  {
    id: 'minimax',
    name: 'MiniMax',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://api.minimax.io/v1',
    websiteUrl: 'https://platform.minimax.io',
    documentationUrl: 'https://platform.minimax.io/docs',
    recommendedModel: 'MiniMax-M2.7',
    icon: 'bi-stars',
    models: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        description: 'Latest, strong reasoning',
        contextWindow: 1000000,
      },
      {
        id: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        description: 'Fast reasoning model',
        contextWindow: 204800,
      },
      {
        id: 'MiniMax-M2.7-highspeed',
        name: 'MiniMax M2.7 Highspeed',
        description: 'Same as M2.7, faster',
        contextWindow: 204800,
      },
    ],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    websiteUrl: 'https://opencode.ai/auth',
    documentationUrl: 'https://opencode.ai/docs/go',
    recommendedModel: 'kimi-k2.7',
    icon: 'bi-stars',
    models: [
      // OpenAI-compatible subset (8 models served via
      // /v1/chat/completions).
      {
        id: 'glm-5.1',
        name: 'GLM-5.1',
        description: 'Strong open coding model',
      },
      {
        id: 'glm-5',
        name: 'GLM-5',
        description: 'Open coding model',
      },
      {
        id: 'kimi-k2.7',
        name: 'Kimi K2.7 Code',
        description: 'Strong open coding model',
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        description: 'Open coding model',
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        description: 'Reasoning model',
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        description: 'Fast and affordable',
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        description: 'High-volume open model',
      },
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        description: 'Reasoning open model',
      },
      // Anthropic-compatible subset (5 models served via
      // /v1/messages). Surfaced under the same "OpenCode Go" card
      // in the UI; the frontend re-maps the providerId to
      // `opencode-go-anthropic` when the user picks one of these
      // because the gateway explicitly rejects them on the OpenAI
      // endpoint (verified empirically).
      {
        id: 'minimax-m3',
        name: 'MiniMax M3',
        description: 'Latest, strong reasoning',
      },
      {
        id: 'minimax-m2.7',
        name: 'MiniMax M2.7',
        description: 'Fast reasoning model',
      },
      {
        id: 'minimax-m2.5',
        name: 'MiniMax M2.5',
        description: 'Reasoning model',
      },
      {
        id: 'qwen3.7-max',
        name: 'Qwen3.7 Max',
        description: 'Strongest Qwen open model',
      },
      {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        description: 'Balanced Qwen open model',
      },
      {
        id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        description: 'Previous-gen Qwen open model',
      },
    ],
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://opencode.ai/zen/v1',
    websiteUrl: 'https://opencode.ai/zen',
    documentationUrl: 'https://opencode.ai/docs/zen',
    recommendedModel: 'mimo-v2.5-free',
    icon: 'bi-stars',
    models: [
      {
        id: 'mimo-v2.5-free',
        name: 'MiMo V2.5 Free',
        description: 'Free tier — high-volume open model',
      },
      {
        id: 'north-mini-code-free',
        name: 'North Mini Code Free',
        description: 'Free tier — coding-specialized open model',
      },
      {
        id: 'nemotron-3-ultra-free',
        name: 'Nemotron 3 Ultra Free',
        description: 'Free tier — NVIDIA open coding model',
      },
      {
        id: 'deepseek-v4-flash-free',
        name: 'DeepSeek V4 Flash Free',
        description: 'Free tier — fast and affordable reasoning',
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    vendorFamily: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    websiteUrl: 'https://ollama.com',
    documentationUrl:
      'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    recommendedModel: '',
    icon: 'bi-cpu',
    local: true,
    // Installed models are host-specific — populated via "Discover models".
    models: [],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    vendorFamily: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    websiteUrl: 'https://lmstudio.ai',
    documentationUrl: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
    recommendedModel: '',
    icon: 'bi-pc-display',
    local: true,
    // Loaded models are host-specific — populated via "Discover models".
    models: [],
  },
];

/**
 * Model IDs that OpenCode Go serves via the Anthropic-compatible
 * endpoint (`/v1/messages`) instead of the OpenAI-compatible one
 * (`/v1/chat/completions`). Used by:
 *
 * - the frontend to re-map the `providerId` from `opencode-go` to
 *   `opencode-go-anthropic` when the user picks one of these
 *   models in a single-dropdown UI;
 * - the `opencode-go-anthropic` provider profile to know which of
 *   the 13 models in the unified preset belong to it.
 *
 * Source of truth: the Endpoints table at
 * https://opencode.ai/docs/go, cross-checked with a live probe of
 * the gateway (the `oa-compat` endpoint returns
 * `Model <id> is not supported for format oa-compat` for these
 * models).
 */
export const OPENCODE_GO_ANTHROPIC_MODEL_IDS: ReadonlySet<string> = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
]);

/**
 * OpenCode Zen — free tier models served via OpenAI-compatible endpoint.
 *
 * Docs: https://opencode.ai/docs/zen
 * Endpoint: https://opencode.ai/zen/v1/chat/completions
 *
 * Auth: Bearer API key (sign up at opencode.ai/zen, add billing, get key).
 * No OAuth. Free to use — no per-request charges for the free-tier models.
 *
 * Only the free-tier models are included here. The full Zen catalog
 * (GPT-5, Claude, Gemini, DeepSeek V4 Pro, etc.) requires a paid plan
 * and is available via OpenCode Go (`opencode-go`) instead.
 */
export const OPENCODE_ZEN_PRESET: ProviderPreset = {
  id: 'opencode-zen',
  name: 'OpenCode Zen',
  vendorFamily: 'openai-compatible',
  baseUrl: 'https://opencode.ai/zen/v1',
  websiteUrl: 'https://opencode.ai/zen',
  documentationUrl: 'https://opencode.ai/docs/zen',
  recommendedModel: 'mimo-v2.5-free',
  icon: 'bi-stars',
  models: [
    {
      id: 'mimo-v2.5-free',
      name: 'MiMo V2.5 Free',
      description: 'Free tier — high-volume open model',
    },
    {
      id: 'north-mini-code-free',
      name: 'North Mini Code Free',
      description: 'Free tier — coding-specialized open model',
    },
    {
      id: 'nemotron-3-ultra-free',
      name: 'Nemotron 3 Ultra Free',
      description: 'Free tier — NVIDIA open coding model',
    },
    {
      id: 'deepseek-v4-flash-free',
      name: 'DeepSeek V4 Flash Free',
      description: 'Free tier — fast and affordable reasoning',
    },
  ],
};

/**
 * Hidden preset for the Anthropic-compatible subset of OpenCode
 * Go. Used by the `OpenCodeGoAnthropicProfile` class to register
 * itself in the provider registry, but deliberately NOT included
 * in `PROVIDER_PRESETS` so it doesn't show up as a separate card
 * in the UI. The frontend surfaces all 13 models under the single
 * "OpenCode Go" card and re-maps the `providerId` to
 * `opencode-go-anthropic` when the chosen model is in
 * `OPENCODE_GO_ANTHROPIC_MODEL_IDS`.
 */
export const OPENCODE_GO_ANTHROPIC_PRESET: ProviderPreset = {
  id: 'opencode-go-anthropic',
  name: 'OpenCode Go (Anthropic)',
  vendorFamily: 'anthropic',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  websiteUrl: 'https://opencode.ai/auth',
  documentationUrl: 'https://opencode.ai/docs/go',
  recommendedModel: 'minimax-m2.7',
  icon: 'bi-stars',
  models: [
    {
      id: 'minimax-m3',
      name: 'MiniMax M3',
      description: 'Latest, strong reasoning',
    },
    {
      id: 'minimax-m2.7',
      name: 'MiniMax M2.7',
      description: 'Fast reasoning model',
    },
    {
      id: 'minimax-m2.5',
      name: 'MiniMax M2.5',
      description: 'Reasoning model',
    },
    {
      id: 'qwen3.7-max',
      name: 'Qwen3.7 Max',
      description: 'Strongest Qwen open model',
    },
    {
      id: 'qwen3.7-plus',
      name: 'Qwen3.7 Plus',
      description: 'Balanced Qwen open model',
    },
    {
      id: 'qwen3.6-plus',
      name: 'Qwen3.6 Plus',
      description: 'Previous-gen Qwen open model',
    },
  ],
};
