/**
 * MiniMax Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth. MiniMax is OpenAI-compatible with thinking
 * block streaming. Uses the same stripThinkingBlocks utility as
 * DeepSeek.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';
import { type HookContext, type StreamChunk } from '../hooks';
import { stripThinkingBlocks } from '../deepseek/index';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'minimax');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'minimax' entry — keep shared-types and providers in sync.",
  );
}

export class MiniMaxProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        aliases: ['minimax-m2'],
        signupUrl: 'https://platform.minimax.chat/',
      }),
    );
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
