import { describe, it, expect } from 'vitest';
import { aggregateUsage, dayOf } from './aggregate';
import type { UsageRunRow } from '@openaidy/db';

function row(overrides: Partial<UsageRunRow>): UsageRunRow {
  return {
    createdAt: '2026-01-01T10:00:00.000Z',
    providerId: 'openai',
    modelId: 'gpt-4o',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cost: 0.01,
    ...overrides,
  };
}

describe('dayOf', () => {
  it('extracts the UTC calendar day', () => {
    expect(dayOf('2026-01-15T23:59:59.000Z')).toBe('2026-01-15');
  });
});

describe('aggregateUsage', () => {
  it('returns zeroed totals for no rows', () => {
    const report = aggregateUsage([]);
    expect(report.totals.runCount).toBe(0);
    expect(report.totals.totalTokens).toBe(0);
    expect(report.totals.hasCost).toBe(false);
    expect(report.byDay).toEqual([]);
    expect(report.byProvider).toEqual([]);
    expect(report.byModel).toEqual([]);
  });

  it('sums overall totals across rows', () => {
    const report = aggregateUsage([
      row({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.01,
      }),
      row({
        promptTokens: 200,
        completionTokens: 60,
        totalTokens: 260,
        cost: 0.02,
      }),
    ]);
    expect(report.totals.runCount).toBe(2);
    expect(report.totals.promptTokens).toBe(300);
    expect(report.totals.completionTokens).toBe(110);
    expect(report.totals.totalTokens).toBe(410);
    expect(report.totals.cost).toBeCloseTo(0.03, 10);
    expect(report.totals.hasCost).toBe(true);
  });

  it('groups by day sorted ascending', () => {
    const report = aggregateUsage([
      row({ createdAt: '2026-01-02T10:00:00.000Z', totalTokens: 10 }),
      row({ createdAt: '2026-01-01T10:00:00.000Z', totalTokens: 20 }),
      row({ createdAt: '2026-01-01T18:00:00.000Z', totalTokens: 5 }),
    ]);
    expect(report.byDay.map((d) => d.day)).toEqual([
      '2026-01-01',
      '2026-01-02',
    ]);
    expect(report.byDay[0]!.totalTokens).toBe(25);
    expect(report.byDay[0]!.runCount).toBe(2);
  });

  it('groups by provider and model sorted by total tokens desc', () => {
    const report = aggregateUsage([
      row({ providerId: 'openai', modelId: 'gpt-4o', totalTokens: 100 }),
      row({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
        totalTokens: 500,
      }),
      row({ providerId: 'openai', modelId: 'gpt-4o', totalTokens: 50 }),
    ]);
    expect(report.byProvider[0]!.providerId).toBe('anthropic');
    expect(report.byModel[0]!.modelId).toBe('claude-sonnet-4');
    const openaiModel = report.byModel.find((m) => m.modelId === 'gpt-4o');
    expect(openaiModel!.totalTokens).toBe(150);
    expect(openaiModel!.runCount).toBe(2);
  });

  it('marks hasCost false when no row has a cost', () => {
    const report = aggregateUsage([row({ cost: null }), row({ cost: null })]);
    expect(report.totals.hasCost).toBe(false);
    expect(report.totals.cost).toBe(0);
  });

  it('accumulates cache tokens', () => {
    const report = aggregateUsage([
      row({ cacheReadTokens: 40, cacheCreationTokens: 10 }),
      row({ cacheReadTokens: 60, cacheCreationTokens: 5 }),
    ]);
    expect(report.totals.cacheReadTokens).toBe(100);
    expect(report.totals.cacheCreationTokens).toBe(15);
  });
});
