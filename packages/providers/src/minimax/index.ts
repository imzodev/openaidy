/**
 * MiniMax Provider Profile
 *
 * MiniMax is OpenAI-compatible with thinking block streaming.
 * Uses the same stripThinkingBlocks utility as DeepSeek.
 */

import { ProviderProfile } from '../types';
import { type HookContext, type StreamChunk } from '../hooks';
import { stripThinkingBlocks } from '../deepseek/index';

export class MiniMaxProfile extends ProviderProfile {
  constructor() {
    super({
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v',
      aliases: ['minimax-m2'],
      apiMode: 'openai-compatible',
      vendorFamily: 'openai-compatible',
      displayName: 'MiniMax',
      description: 'MiniMax M-series models with thinking support',
      signupUrl: 'https://platform.minimax.chat/',
      defaultModel: 'MiniMax-M2.7-32K',
      models: [
        {
          id: 'MiniMax-M2.7-32K',
          name: 'MiniMax M2.7 32K',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 32_000,
          maxOutputTokens: 8_000,
        },
        {
          id: 'MiniMax-M2-32K',
          name: 'MiniMax M2 32K',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
          contextWindow: 32_000,
          maxOutputTokens: 8_000,
        },
        {
          id: 'abab6.5s-chat',
          name: 'ABAB 6.5S Chat',
          capabilities: ['text_generation', 'streaming'],
          contextWindow: 128_000,
          maxOutputTokens: 8_000,
        },
      ],
    });
  }

  /** Handle MiniMax's thinking block streaming in onStreamChunk */
  override onStreamChunk(
    chunk: StreamChunk,
    _context: HookContext,
  ): StreamChunk {
    const delta = chunk.delta as string | undefined;
    if (
      delta !== undefined &&
      typeof delta === 'string' &&
      delta.match(/^[DI]$/m)
    ) {
      return { ...chunk, reasoningContent: delta };
    }
    return chunk;
  }

  /**
   * Strip thinking blocks from content when emitting.
   * The adapter can use this to clean response text.
   */
  cleanContent(text: string): string {
    return stripThinkingBlocks(text);
  }
}

import { registry } from '../registry';

registry.register(new MiniMaxProfile());
