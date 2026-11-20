import { describe, it, expect } from 'vitest';
import {
  applyLatestSummary,
  findCompactionCut,
  renderTranscript,
} from './compaction';

const msg = (
  sequence: number,
  role: string,
  content = `${role}-${sequence}`,
  metadata?: Record<string, unknown>,
) => ({ sequence, role, content, ...(metadata ? { metadata } : {}) });

describe('applyLatestSummary', () => {
  it('returns history unchanged when there is no summary', () => {
    const rows = [msg(1, 'user'), msg(2, 'assistant')];
    expect(applyLatestSummary(rows)).toEqual({
      messages: rows,
      summary: undefined,
    });
  });

  it('drops covered rows and summary rows, using the latest summary', () => {
    const rows = [
      msg(1, 'user'),
      msg(2, 'assistant'),
      msg(3, 'system', 'old summary', {
        kind: 'compaction_summary',
        coversThroughSequence: 1,
      }),
      msg(4, 'user'),
      msg(5, 'system', 'new summary', {
        kind: 'compaction_summary',
        coversThroughSequence: 2,
      }),
      msg(6, 'assistant'),
    ];
    const { messages, summary } = applyLatestSummary(rows);
    expect(summary).toBe('new summary');
    expect(messages.map((m) => m.sequence)).toEqual([4, 6]);
  });
});

describe('findCompactionCut', () => {
  it('returns 0 when there are too few user turns', () => {
    const rows = [msg(1, 'user'), msg(2, 'assistant'), msg(3, 'user')];
    expect(findCompactionCut(rows, 2)).toBe(0);
  });

  it('cuts at the start of the Nth-from-last user turn', () => {
    const rows = [
      msg(1, 'user'),
      msg(2, 'assistant'),
      msg(3, 'tool'),
      msg(4, 'user'),
      msg(5, 'assistant'),
      msg(6, 'user'),
    ];
    expect(findCompactionCut(rows, 2)).toBe(3);
  });
});

describe('renderTranscript', () => {
  it('excerpts long tool results and notes tool calls', () => {
    const text = renderTranscript(
      [
        msg(1, 'assistant', 'checking', {
          toolCalls: [{ name: 'web_fetch', arguments: '{"url":"x"}' }],
        }),
        msg(2, 'tool', 'y'.repeat(5_000), { toolName: 'web_fetch' }),
      ],
      100_000,
    );
    expect(text).toContain('called web_fetch({"url":"x"})');
    expect(text).toContain('[5000 chars]');
    expect(text.length).toBeLessThan(2_000);
  });

  it('keeps the most recent part when over the limit', () => {
    const text = renderTranscript(
      [msg(1, 'user', 'a'.repeat(500)), msg(2, 'user', 'LATEST')],
      100,
    );
    expect(text).toContain('LATEST');
    expect(text).toContain('earlier part omitted');
  });
});
