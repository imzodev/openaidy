import { describe, it, expect } from 'vitest';
import { stripThinking, extractThinking } from './message.js';

describe('stripThinking', () => {
  it('strips a complete <think> block', () => {
    expect(stripThinking('<think>let me reason...</think>\nCOMPLETED')).toBe(
      'COMPLETED',
    );
  });

  it('strips an unterminated <think> block truncated mid-reasoning', () => {
    expect(
      stripThinking('Before.<think>reasoning cut off by max-tokens...'),
    ).toBe('Before.');
  });

  it('returns an all-reasoning truncated reply as an empty string', () => {
    expect(stripThinking('<think>only reasoning, never finished')).toBe('');
  });

  it('leaves content without a <think> tag byte-for-byte untouched', () => {
    expect(stripThinking('  Plain reply with padding.  ')).toBe(
      '  Plain reply with padding.  ',
    );
  });

  it('trims only when a <think> block was actually removed', () => {
    expect(stripThinking('  <think>x</think>  Answer  ')).toBe('Answer');
  });
});

describe('extractThinking', () => {
  it('extracts and joins multiple thinking blocks', () => {
    expect(extractThinking('<think>one</think>mid<think>two</think>')).toBe(
      'one\n\ntwo',
    );
  });

  it('returns an empty string when there is no thinking block', () => {
    expect(extractThinking('no thinking here')).toBe('');
  });
});
