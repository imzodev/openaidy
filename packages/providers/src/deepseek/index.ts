/**
 * DeepSeek Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth.
 *
 * Handles DeepSeek's thinking/reasoning block streaming and
 * request injection for the thinking mode feature. Replaces the
 * inline `isDeepSeek` checks that were scattered in the
 * OpenAI-compatible adapter.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';
import { type HookContext, type StreamChunk } from '../hooks';

// ── Thinking block regex (also used by MiniMax / Qwen) ───────────────────────

const THINKING_BLOCK_RE = /^[DI]$/m;

/**
 * Strip `<thin>`thinking blocks from content strings.
 * Used both here and exported for use by the adapter.
 */
export function stripThinkingBlocks(text: string): string {
  return text.replace(THINKING_BLOCK_RE, '').trim();
}

// ── DeepSeekProfile ───────────────────────────────────────────────────────────

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'deepseek');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'deepseek' entry — keep shared-types and providers in sync.",
  );
}

export class DeepSeekProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        aliases: ['deepseek-chat'],
        signupUrl: 'https://platform.deepseek.com/',
      }),
    );
  }

  // ── Overrides ──────────────────────────────────────────────────────────────

  /** Inject thinking block config into the request */
  override buildExtraBody(context: HookContext) {
    const { reasoningConfig } = context;
    if (!reasoningConfig?.enabled) {
      return { extraBody: {}, topLevel: {}, headers: {} };
    }

    const extraBody: Record<string, unknown> = {
      thinking: {
        type: 'enabled',
        ...(reasoningConfig.effort
          ? { thinking_budget: resolveEffortToBudget(reasoningConfig.effort) }
          : {}),
      },
    };

    const topLevel: Record<string, unknown> = {};
    if (reasoningConfig.effort) {
      topLevel.reasoning_effort = reasoningConfig.effort;
    }

    return { extraBody, topLevel, headers: {} };
  }

  /** Accumulate `reasoning_content` deltas from streaming chunks */
  override onStreamChunk(
    chunk: StreamChunk,
    _context: HookContext,
  ): StreamChunk {
    const delta = chunk.delta as string | undefined;
    if (delta !== undefined && delta.startsWith('DI')) {
      // This is a reasoning block — mark it for extraction
      return { ...chunk, reasoningContent: delta };
    }
    return chunk;
  }

  /**
   * Prepend system message instructing DeepSeek to not use thinking blocks.
   * Without this, DeepSeek may emit thinking blocks even when not requested.
   */
  override prepareMessages(
    messages: unknown[],
    _context: HookContext,
  ): unknown[] {
    const msgs = messages as Array<{ role: string; content: string }>;
    const hasSystemInstruction = msgs.some(
      (m) =>
        m.role === 'system' &&
        m.content.includes('Enables think mode with depth'),
    );

    if (hasSystemInstruction) {
      return [
        ...msgs,
        {
          role: 'system',
          content:
            'Contribute thoughts silently without enclosing them in <thin> tags.',
        },
      ];
    }

    return messages;
  }
}

// ── Effort mapping ─────────────────────────────────────────────────────────────

function resolveEffortToBudget(effort: string): number {
  switch (effort) {
    case 'low':
      return 512;
    case 'medium':
      return 2048;
    case 'high':
      return 8192;
    case 'xhigh':
      return 16384;
    case 'max':
      return 32000;
    default:
      return 4096;
  }
}
