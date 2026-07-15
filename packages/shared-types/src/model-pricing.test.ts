import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICING,
  resolveModelPricing,
  calculateCost,
  estimateCost,
  type ModelPricing,
} from './model-pricing.js';

describe('resolveModelPricing', () => {
  it('resolves an exact model id (case-insensitive)', () => {
    expect(resolveModelPricing('gpt-4o')).toBe(MODEL_PRICING['gpt-4o']);
    expect(resolveModelPricing('GPT-4O')).toBe(MODEL_PRICING['gpt-4o']);
  });

  it('resolves a dated snapshot to its longest known prefix', () => {
    expect(resolveModelPricing('gpt-4o-2024-08-06')).toBe(
      MODEL_PRICING['gpt-4o'],
    );
    // 'gpt-4o-mini' is a longer prefix than 'gpt-4o' for a mini snapshot.
    expect(resolveModelPricing('gpt-4o-mini-2024-07-18')).toBe(
      MODEL_PRICING['gpt-4o-mini'],
    );
  });

  it('returns null for an unknown model', () => {
    expect(resolveModelPricing('totally-unknown-model')).toBeNull();
  });

  it('prefers overrides over the static table', () => {
    const override: ModelPricing = { promptPer1k: 1, completionPer1k: 2 };
    expect(resolveModelPricing('gpt-4o', { 'gpt-4o': override })).toBe(
      override,
    );
  });

  it('falls back to the static table when an override does not match', () => {
    const override: ModelPricing = { promptPer1k: 1, completionPer1k: 2 };
    expect(resolveModelPricing('gpt-4o', { 'other-model': override })).toBe(
      MODEL_PRICING['gpt-4o'],
    );
  });
});

describe('calculateCost', () => {
  const pricing: ModelPricing = {
    promptPer1k: 0.01,
    completionPer1k: 0.03,
    cacheReadPer1k: 0.001,
    cacheCreationPer1k: 0.0125,
  };

  it('computes basic prompt + completion cost', () => {
    const cost = calculateCost(
      { promptTokens: 1000, completionTokens: 1000 },
      pricing,
    );
    // 1.0 * 0.01 + 1.0 * 0.03
    expect(cost).toBeCloseTo(0.04, 10);
  });

  it('applies the cache-read discount to cached prompt tokens', () => {
    const cost = calculateCost(
      { promptTokens: 1000, completionTokens: 0, cacheReadTokens: 400 },
      pricing,
    );
    // fresh 600 @ 0.01/1k = 0.006 ; cached 400 @ 0.001/1k = 0.0004
    expect(cost).toBeCloseTo(0.0064, 10);
  });

  it('bills cache-creation tokens at their own rate', () => {
    const cost = calculateCost(
      {
        promptTokens: 1000,
        completionTokens: 0,
        cacheCreationTokens: 200,
      },
      pricing,
    );
    // fresh 800 @ 0.01/1k = 0.008 ; creation 200 @ 0.0125/1k = 0.0025
    expect(cost).toBeCloseTo(0.0105, 10);
  });

  it('falls back to the prompt rate when cache rates are absent', () => {
    const noCacheRates: ModelPricing = {
      promptPer1k: 0.01,
      completionPer1k: 0.03,
    };
    const cost = calculateCost(
      { promptTokens: 1000, completionTokens: 0, cacheReadTokens: 500 },
      noCacheRates,
    );
    // fresh 500 @ 0.01 + cached 500 @ 0.01 (fallback) = 0.01
    expect(cost).toBeCloseTo(0.01, 10);
  });

  it('never returns a negative cost when cache exceeds prompt', () => {
    const cost = calculateCost(
      { promptTokens: 100, completionTokens: 0, cacheReadTokens: 500 },
      pricing,
    );
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

describe('estimateCost', () => {
  it('returns null for an unknown model', () => {
    expect(
      estimateCost('unknown-model', {
        promptTokens: 100,
        completionTokens: 10,
      }),
    ).toBeNull();
  });

  it('returns a number for a known model', () => {
    const cost = estimateCost('gpt-4o', {
      promptTokens: 1000,
      completionTokens: 1000,
    });
    expect(cost).toBeGreaterThan(0);
  });
});
