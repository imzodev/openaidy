import {
  OPENCODE_GO_ANTHROPIC_PRESET,
  OPENCODE_ZEN_PRESET,
  PROVIDER_PRESETS,
  type ModelPreset,
} from '@openaidy/shared-types';

const ALL_PRESETS = [
  ...PROVIDER_PRESETS,
  OPENCODE_ZEN_PRESET,
  OPENCODE_GO_ANTHROPIC_PRESET,
];

/**
 * Context window and output limit for a model id, from the built-in
 * provider presets. Adapters mostly don't report these, so the presets are
 * the only place they are known.
 */
export function findPresetModel(
  modelId: string,
): Pick<ModelPreset, 'contextWindow' | 'maxOutputTokens'> | undefined {
  for (const preset of ALL_PRESETS) {
    const model = preset.models.find((m) => m.id === modelId);
    if (model) return model;
  }
  return undefined;
}

/**
 * Default `max_tokens` for an Anthropic Messages API request. The API
 * requires the field, and a value above a model's limit is rejected, so
 * only Claude generations known to allow more get a higher default; the
 * same adapter also serves non-Claude models (opencode-go), which keep the
 * old conservative value.
 */
export function anthropicDefaultMaxTokens(modelId: string): number {
  const preset = findPresetModel(modelId)?.maxOutputTokens;
  if (preset) return Math.min(preset, 32_000);
  if (/^claude-3-(haiku|sonnet|opus)/.test(modelId)) return 4_096;
  if (/^claude-3-[57]/.test(modelId)) return 8_192;
  if (modelId.startsWith('claude-')) return 16_384;
  return 4_096;
}
