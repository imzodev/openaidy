import { describe, it, expect } from 'vitest';
import { anthropicDefaultMaxTokens, findPresetModel } from './model-limits';

describe('anthropicDefaultMaxTokens', () => {
  it('raises the default for current Claude models', () => {
    expect(anthropicDefaultMaxTokens('claude-sonnet-4-6')).toBe(16_384);
  });

  it('keeps older Claude generations within their limits', () => {
    expect(anthropicDefaultMaxTokens('claude-3-haiku-20240307')).toBe(4_096);
    expect(anthropicDefaultMaxTokens('claude-3-5-sonnet-20241022')).toBe(8_192);
  });

  it('stays conservative for non-Claude models on the Anthropic API', () => {
    expect(anthropicDefaultMaxTokens('some-other-model')).toBe(4_096);
  });
});

describe('findPresetModel', () => {
  it('finds preset limits by model id', () => {
    expect(findPresetModel('claude-sonnet-4-6')?.contextWindow).toBe(200_000);
    expect(findPresetModel('nope')).toBeUndefined();
  });
});
