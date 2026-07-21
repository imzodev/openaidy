/**
 * Tests for the Gemini SSE parser.
 *
 * These exist primarily to lock down the behavior that the previous
 * inline `\n`-split parser got wrong: handling `data:` lines
 * without a trailing space, multi-line data fields, CRLF endings,
 * comments, and partial events at chunk boundaries.
 *
 * The parser must also produce *no* events from a trailing blank
 * line — a `data: foo\n\n` followed by a stray `\n` should still
 * produce exactly one event, not a phantom second event with empty
 * data.
 */

import { describe, it, expect } from 'vitest';
import { takeSseEvents } from './sse-parser';
import type { SseParserState } from './sse-parser.types';

function fresh(): SseParserState {
  return { buffer: '' };
}

describe('takeSseEvents', () => {
  it('emits a single event terminated by a blank line', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"a":1}\n\n');
    expect(events).toEqual([{ data: '{"a":1}' }]);
    expect(state.buffer).toBe('');
  });

  it('handles `data:` without a trailing space', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data:{"a":1}\n\n');
    expect(events).toEqual([{ data: '{"a":1}' }]);
  });

  it('joins multi-line data fields with a single newline', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: line1\ndata: line2\n\n');
    expect(events).toEqual([{ data: 'line1\nline2' }]);
  });

  it('skips comment lines (`: some comment`)', () => {
    const state = fresh();
    const events = takeSseEvents(state, ': heartbeat\ndata: {"a":1}\n\n');
    expect(events).toEqual([{ data: '{"a":1}' }]);
  });

  it('normalizes CRLF line endings', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"a":1}\r\n\r\n');
    expect(events).toEqual([{ data: '{"a":1}' }]);
    expect(state.buffer).toBe('');
  });

  it('normalizes bare CR line endings', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"a":1}\r\r');
    expect(events).toEqual([{ data: '{"a":1}' }]);
  });

  it('retains a trailing partial line in the buffer', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"a"');
    expect(events).toEqual([]);
    expect(state.buffer).toBe('data: {"a"');
  });

  it('retains a partial event (no terminating blank line) in the buffer', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"a":1}\n');
    expect(events).toEqual([]);
    expect(state.buffer).toBe('data: {"a":1}\n');
  });

  it('emits two complete events in a single chunk', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"n":1}\n\ndata: {"n":2}\n\n');
    expect(events).toEqual([{ data: '{"n":1}' }, { data: '{"n":2}' }]);
  });

  it('emits complete events while keeping a trailing partial one', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"n":1}\n\ndata: {"n":2');
    expect(events).toEqual([{ data: '{"n":1}' }]);
    expect(state.buffer).toBe('data: {"n":2');
  });

  it('parses a heartbeat between real chunks without emitting the heartbeat', () => {
    const state = fresh();
    const events = takeSseEvents(
      state,
      'data: {"a":1}\n\n: ping\n\ndata: {"a":2}\n\n',
    );
    expect(events).toEqual([{ data: '{"a":1}' }, { data: '{"a":2}' }]);
  });

  it('carries state across multiple takeSseEvents calls (streamed chunks)', () => {
    const state = fresh();

    expect(takeSseEvents(state, 'data: {"a')).toEqual([]);
    expect(takeSseEvents(state, '":1}\n\n')).toEqual([{ data: '{"a":1}' }]);
    expect(takeSseEvents(state, 'data: {"b":2}\n')).toEqual([]);
    expect(state.buffer).toBe('data: {"b":2}\n');
    expect(takeSseEvents(state, '\n')).toEqual([{ data: '{"b":2}' }]);
    expect(state.buffer).toBe('');
  });

  it('does not emit a phantom event for a single trailing newline after a complete event', () => {
    // Regression: the old `\n`-split parser would treat every blank
    // line as a fresh event, and `data: foo\n\n` followed by a
    // stray `\n` produced a second event with empty data — which
    // then failed `JSON.parse("")` and triggered a warning, or worse
    // accidentally emitted a `stream.started` for `{}` followed by
    // a malformed-JSON skip. The new parser must not.
    const state = fresh();
    const events = takeSseEvents(state, 'data: {"n":1}\n\n\n');
    expect(events).toEqual([{ data: '{"n":1}' }]);
  });

  it('skips events that have no `data:` field (event-only or id-only events)', () => {
    const state = fresh();
    const events = takeSseEvents(state, 'event: ping\n\n');
    expect(events).toEqual([]);
  });

  it('returns an empty array for an empty chunk', () => {
    const state = fresh();
    expect(takeSseEvents(state, '')).toEqual([]);
    expect(state.buffer).toBe('');
  });

  it('ignores `event:`, `id:`, and `retry:` fields (captured for spec completeness only)', () => {
    // Even if the server sent these, they must not appear in `data`.
    const state = fresh();
    const events = takeSseEvents(
      state,
      'id: 42\nevent: message\nretry: 1000\ndata: {"a":1}\n\n',
    );
    expect(events).toEqual([{ data: '{"a":1}' }]);
  });

  it('handles a leading LF (server sometimes prepends one)', () => {
    const state = fresh();
    const events = takeSseEvents(state, '\ndata: {"a":1}\n\n');
    expect(events).toEqual([{ data: '{"a":1}' }]);
  });
});
