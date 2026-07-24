import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import type { UsageReport, UsageTotals } from '../../lib/types';

vi.mock('../../lib/api', () => ({
  getUsage: vi.fn(),
}));

import { getUsage } from '../../lib/api';
import { UsagePage } from './UsagePage';

function totals(over: Partial<UsageTotals>): UsageTotals {
  return {
    runCount: 1,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cost: 0,
    hasCost: false,
    ...over,
  };
}

/**
 * Two days, two models. Day 1 has exactly double the tokens of day 2 so
 * the test can assert bar heights scale with the day's total. Model rank
 * order is anthropic/claude (900) > openai/gpt (600), so claude gets
 * palette[0] (blue) and gpt gets palette[1] (emerald).
 */
function report(): UsageReport {
  return {
    totals: totals({ runCount: 4, totalTokens: 1500 }),
    byDay: [
      { ...totals({ totalTokens: 1000 }), day: '2026-07-20' },
      { ...totals({ totalTokens: 500 }), day: '2026-07-21' },
    ],
    byProvider: [],
    byModel: [
      {
        ...totals({ runCount: 3, totalTokens: 900 }),
        providerId: 'anthropic',
        modelId: 'claude',
      },
      {
        ...totals({ runCount: 1, totalTokens: 600 }),
        providerId: 'openai',
        modelId: 'gpt',
      },
    ],
    byDayByModel: [
      {
        ...totals({ totalTokens: 800 }),
        day: '2026-07-20',
        providerId: 'anthropic',
        modelId: 'claude',
      },
      {
        ...totals({ totalTokens: 200 }),
        day: '2026-07-20',
        providerId: 'openai',
        modelId: 'gpt',
      },
      {
        ...totals({ totalTokens: 400 }),
        day: '2026-07-21',
        providerId: 'openai',
        modelId: 'gpt',
      },
      {
        ...totals({ totalTokens: 100 }),
        day: '2026-07-21',
        providerId: 'anthropic',
        modelId: 'claude',
      },
    ],
  };
}

/** Stacked-bar segments = svg rects whose class carries a model hue. */
function segmentRects(container: HTMLElement): SVGRectElement[] {
  return [...container.querySelectorAll('svg rect')].filter((r) => {
    const cls = r.getAttribute('class') ?? '';
    return cls.includes('fill-') && !cls.includes('fill-gray');
  }) as SVGRectElement[];
}

/** Hue shared by a fill/bg class pair, e.g. "fill-blue-500" → "blue-500". */
function hueOf(cls: string, prefix: 'fill' | 'bg'): string | null {
  const m = cls.match(new RegExp(`${prefix}-([a-z]+-\\d+)`));
  return m?.[1] ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUsage).mockResolvedValue(report());
});

describe('UsagePage — stacked daily chart', () => {
  it('renders one colored segment per model per day', async () => {
    const { container } = render(() => <UsagePage />);
    await screen.findByText('Tokens per day, by model');

    const segments = segmentRects(container);
    expect(segments).toHaveLength(4);
    const hues = segments.map((r) => hueOf(r.getAttribute('class')!, 'fill'));
    // Rank order: claude = blue (palette[0]), gpt = emerald (palette[1]).
    expect(hues.filter((h) => h === 'blue-500')).toHaveLength(2);
    expect(hues.filter((h) => h === 'emerald-500')).toHaveLength(2);
  });

  it('scales bar heights by the day total (double the tokens = double the height)', async () => {
    const { container } = render(() => <UsagePage />);
    await screen.findByText('Tokens per day, by model');

    // Group segments by x (one x per day) and sum their heights.
    const byX = new Map<string, number>();
    for (const r of segmentRects(container)) {
      const x = r.getAttribute('x')!;
      byX.set(x, (byX.get(x) ?? 0) + Number(r.getAttribute('height')));
    }
    const heights = [...byX.values()].sort((a, b) => b - a);
    expect(heights).toHaveLength(2);
    expect(heights[1]! / heights[0]!).toBeCloseTo(0.5, 5);
  });

  it('shows a cursor-following tooltip when hovering a segment', async () => {
    const { container } = render(() => <UsagePage />);
    await screen.findByText('Tokens per day, by model');

    const segment = segmentRects(container).find((r) =>
      (r.getAttribute('class') ?? '').includes('fill-blue-500'),
    )!;
    fireEvent.mouseMove(segment, { clientX: 100, clientY: 50 });

    // The legend always shows the model key; a second copy means the
    // tooltip appeared. The percentage line is unique to the tooltip.
    const matches = await screen.findAllByText('anthropic/claude');
    expect(matches).toHaveLength(2);
    expect(screen.getByText(/80\.0% of day/)).toBeInTheDocument();
  });
});

describe('UsagePage — model colors match across chart, legend and table', () => {
  it('gives every legend item a painted swatch using the model hue', async () => {
    render(() => <UsagePage />);
    await screen.findByText('Tokens per day, by model');

    const legend = await screen.findByRole('button', {
      name: /anthropic\/claude/,
    });
    const dot = legend.querySelector('span[aria-hidden="true"]')!;
    expect(hueOf(dot.getAttribute('class')!, 'bg')).toBe('blue-500');

    const legend2 = screen.getByRole('button', { name: /openai\/gpt/ });
    const dot2 = legend2.querySelector('span[aria-hidden="true"]')!;
    expect(hueOf(dot2.getAttribute('class')!, 'bg')).toBe('emerald-500');
  });

  it('marks each By-model table row with a dot in the same hue as its bar segments', async () => {
    const { container } = render(() => <UsagePage />);
    await screen.findByText('By model');

    const rows = [...container.querySelectorAll('tbody tr')];
    const claudeRow = rows.find((r) => r.textContent?.includes('claude'))!;
    const gptRow = rows.find((r) => r.textContent?.includes('gpt'))!;

    const claudeDot = claudeRow.querySelector('span[aria-hidden="true"]')!;
    expect(hueOf(claudeDot.getAttribute('class')!, 'bg')).toBe('blue-500');

    const gptDot = gptRow.querySelector('span[aria-hidden="true"]')!;
    expect(hueOf(gptDot.getAttribute('class')!, 'bg')).toBe('emerald-500');
  });

  it('dims other models’ segments when a legend item is hovered', async () => {
    const { container } = render(() => <UsagePage />);
    await screen.findByText('Tokens per day, by model');

    const legend = await screen.findByRole('button', {
      name: /anthropic\/claude/,
    });
    fireEvent.mouseEnter(legend);

    for (const r of segmentRects(container)) {
      const cls = r.getAttribute('class') ?? '';
      const expected = cls.includes('fill-blue-500') ? '1' : '0.2';
      expect(r.style.opacity).toBe(expected);
    }
  });
});
