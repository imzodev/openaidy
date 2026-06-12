/**
 * Groq Provider Profile
 *
 * Simple OpenAI-compatible provider with fast inference.
 * No special hooks needed — pure passthrough.
 */

import { ProviderProfile } from '../types';

export class GroqProfile extends ProviderProfile {
  constructor() {
    super({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      aliases: [],
      apiMode: 'openai-compatible',
      vendorFamily: 'openai-compatible',
      displayName: 'Groq',
      description: 'Fast OpenAI-compatible inference',
      signupUrl: 'https://console.groq.com/',
      defaultModel: 'llama-3.3-70b-versatile',
      models: [
        {
          id: 'llama-3.3-70b-versatile',
          name: 'Llama 3.3 70B Versatile',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 128_000,
          maxOutputTokens: 8_000,
        },
        {
          id: 'mixtral-8x7b-32768',
          name: 'Mixtral 8x7B',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 32_768,
          maxOutputTokens: 8_000,
        },
        {
          id: 'qwen-2.5-32b-codestral',
          name: 'Qwen 2.5 32B Codestral',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 32_000,
          maxOutputTokens: 8_000,
        },
      ],
    });
  }
}
