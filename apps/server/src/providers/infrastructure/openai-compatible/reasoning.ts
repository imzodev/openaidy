import {
  clampReasoningEffort,
  resolveReasoningSupport,
  type ReasoningEffort,
} from '@aidyagent/shared-types';

/**
 * Extra Chat Completions fields that set how hard the model thinks.
 *
 * Chosen by model rather than provider, because gateways (OpenCode Go,
 * OpenRouter-style hosts) serve DeepSeek and OpenAI models behind the same
 * OpenAI-compatible endpoint. Returns no fields for models with no known
 * control, or when no effort is set, so nothing changes for them. A level
 * the model lacks moves to the closest one (DeepSeek: medium → high).
 */
export function reasoningRequestParams(
  modelId: string,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> {
  const support = resolveReasoningSupport(modelId);
  const level = clampReasoningEffort(support, effort);
  if (!support || !level) return {};

  if (support.style === 'deepseek') {
    return level === 'off'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'enabled' }, reasoning_effort: level };
  }
  if (support.style === 'openai' && level !== 'off') {
    return { reasoning_effort: level };
  }
  return {};
}
