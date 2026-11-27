import { describe, it, expect } from 'vitest';
import { clampReasoningEffort, resolveReasoningSupport } from './reasoning.js';

describe('resolveReasoningSupport', () => {
  it.each([
    ['deepseek/deepseek-v4-flash', 'deepseek'],
    ['opencode-go/deepseek-v4-pro', 'deepseek'],
    ['deepseek-reasoner', 'deepseek'],
    ['openai/o3', 'openai'],
    ['o4-mini', 'openai'],
    ['google/gemini-2.5-flash', 'gemini-budget'],
    ['gemini-2.5-pro', 'gemini-budget'],
    ['gemini-3.5-flash', 'gemini-level'],
    ['anthropic/claude-opus-4-7', 'anthropic-effort'],
    ['claude-sonnet-4-6', 'anthropic-effort'],
    ['claude-opus-5-5', 'anthropic-effort'],
    ['claude-haiku-5-5', 'anthropic-effort'],
  ])('%s → %s', (model, style) => {
    expect(resolveReasoningSupport(model)?.style).toBe(style);
  });

  it.each([
    'openai/gpt-4o',
    'claude-haiku-4-5',
    'claude-sonnet-4-5',
    'opencode-go/mimo-v2.5',
    'glm-5.1',
    'gemini-2.0-flash',
    '',
    undefined,
  ])('%s has no known control', (model) => {
    expect(resolveReasoningSupport(model)).toBeNull();
  });

  it('Gemini 2.5 Pro cannot turn thinking off; Flash can', () => {
    expect(resolveReasoningSupport('gemini-2.5-pro')?.levels).not.toContain(
      'off',
    );
    expect(resolveReasoningSupport('gemini-2.5-flash')?.levels).toContain(
      'off',
    );
  });
});

describe('clampReasoningEffort', () => {
  const deepseek = resolveReasoningSupport('deepseek-v4-flash');
  const gemini3 = resolveReasoningSupport('gemini-3.5-flash');

  it('keeps a supported level', () => {
    expect(clampReasoningEffort(deepseek, 'max')).toBe('max');
  });

  it('moves an unsupported level to the closest one, ties going up', () => {
    expect(clampReasoningEffort(deepseek, 'medium')).toBe('high');
    expect(clampReasoningEffort(gemini3, 'max')).toBe('high');
    expect(clampReasoningEffort(gemini3, 'off')).toBe('low');
  });

  it('returns undefined with no effort or no support', () => {
    expect(clampReasoningEffort(deepseek, undefined)).toBeUndefined();
    expect(clampReasoningEffort(null, 'high')).toBeUndefined();
  });
});
