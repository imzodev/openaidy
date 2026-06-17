/**
 * OpenRouter Provider Profile
 *
 * OpenRouter aggregates many providers behind a unified OpenAI-compatible API.
 * No special hooks needed — pure passthrough.
 */

import { ProviderProfile } from '../types';

export class OpenRouterProfile extends ProviderProfile {
  constructor() {
    super({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      aliases: [],
      apiMode: 'openai-compatible',
      vendorFamily: 'openai-compatible',
      displayName: 'OpenRouter',
      description: 'Unified API for multiple LLM providers',
      signupUrl: 'https://openrouter.ai/',
      defaultModel: 'openai/gpt-4o-mini',
      models: [
        {
          id: 'openai/gpt-4o-mini',
          name: 'GPT-4o Mini',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 128_000,
          maxOutputTokens: 16_384,
        },
        {
          id: 'anthropic/claude-3.5-haiku',
          name: 'Claude 3.5 Haiku',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 200_000,
          maxOutputTokens: 8_192,
        },
        {
          id: 'deepseek/deepseek-chat-v3-0324',
          name: 'DeepSeek V3',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 64_000,
          maxOutputTokens: 8_000,
        },
      ],
    });
  }
}
