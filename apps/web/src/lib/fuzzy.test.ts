import { describe, it, expect } from 'vitest';
import { fuzzyFilter, scoreCandidate } from './fuzzy';

describe('scoreCandidate', () => {
  it('returns 0 for an empty query (matches everything)', () => {
    expect(scoreCandidate('', 'Go to Chat')).toBe(0);
    expect(scoreCandidate('   ', 'Go to Chat')).toBe(0);
  });

  it('returns -Infinity when no match is possible', () => {
    expect(scoreCandidate('xyz', 'Go to Chat')).toBe(-Infinity);
  });

  it('strongly favours exact substring matches', () => {
    const exact = scoreCandidate('chat', 'Go to Chat');
    const chars = scoreCandidate('gc', 'Go to Chat');
    expect(exact).toBeGreaterThan(chars);
  });

  it('rewards word-boundary matches', () => {
    const boundary = scoreCandidate('chat', 'Go to Chat');
    const interior = scoreCandidate('hat', 'Go to Chat');
    expect(boundary).toBeGreaterThan(interior);
  });

  it('matches initials like "gc" -> "Go to Chat"', () => {
    expect(scoreCandidate('gc', 'Go to Chat')).toBeGreaterThan(0);
    expect(scoreCandidate('gos', 'Go to Sessions')).toBeGreaterThan(0);
  });

  it('matches char-order sequences', () => {
    expect(scoreCandidate('gtch', 'Go to Chat')).toBeGreaterThan(0);
    expect(scoreCandidate('zzz', 'Go to Chat')).toBe(-Infinity);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    'Go to Sessions',
    'Go to Chat',
    'Go to Agents',
    'Go to Tasks',
    'Go to Settings',
    'New Session',
    'Toggle Theme',
    'Stop Agent',
  ];

  it('returns everything when query is empty, in original order', () => {
    expect(fuzzyFilter('', items, (s) => s)).toEqual(items);
  });

  it('ranks exact substring matches first', () => {
    const result = fuzzyFilter('agents', items, (s) => s);
    expect(result[0]).toBe('Go to Agents');
  });

  it('matches initials across words', () => {
    const result = fuzzyFilter('gtc', items, (s) => s);
    expect(result[0]).toBe('Go to Chat');
  });

  it('returns an empty array when nothing matches', () => {
    expect(fuzzyFilter('zzzzz', items, (s) => s)).toEqual([]);
  });

  it('keeps original item references', () => {
    const objs = items.map((label, id) => ({ id, label }));
    const result = fuzzyFilter('agents', objs, (o) => o.label);
    expect(result[0].id).toBe(2);
  });
});
