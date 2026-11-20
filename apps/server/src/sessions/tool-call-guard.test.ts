import { describe, it, expect } from 'vitest';
import { ToolCallGuard, toolCallKey } from './tool-call-guard';

const READ_ONLY = new Set(['code_read', 'web_fetch']);

function guard(maxCallsPerRound = 12) {
  return new ToolCallGuard({
    maxCallsPerRound,
    maxRefusals: 3,
    isReadOnly: (name) => READ_ONLY.has(name),
  });
}

const read = { name: 'code_read', arguments: { path: 'a.ts' } };
const edit = { name: 'code_edit', arguments: { path: 'a.ts', text: 'x' } };

describe('toolCallKey', () => {
  it('ignores argument key order', () => {
    expect(
      toolCallKey({ name: 't', arguments: { a: 1, b: { c: 2, d: 3 } } }),
    ).toBe(toolCallKey({ name: 't', arguments: { b: { d: 3, c: 2 }, a: 1 } }));
  });
});

describe('ToolCallGuard', () => {
  it('runs a first call', () => {
    expect(guard().review([read])).toEqual([{ action: 'run' }]);
  });

  it('refuses a repeat of a successful read and returns the earlier result', () => {
    const g = guard();
    g.record(read, 0, { ok: true, content: 'file body' });
    const [verdict] = g.review([read]);
    expect(verdict).toMatchObject({ action: 'skip', reason: 'repeat' });
    expect(verdict?.action === 'skip' && verdict.content).toContain(
      'file body',
    );
  });

  it('allows re-reading after a write may have changed state', () => {
    const g = guard();
    g.record(read, 0, { ok: true, content: 'old' });
    g.record(edit, 1, { ok: true, content: 'edited' });
    expect(g.review([read])).toEqual([{ action: 'run' }]);
  });

  it('refuses a repeat of a successful write', () => {
    const g = guard();
    g.record(edit, 0, { ok: true, content: 'edited' });
    expect(g.review([edit])[0]).toMatchObject({ reason: 'repeat' });
  });

  it('allows one retry of a failed call, then refuses', () => {
    const g = guard();
    g.record(read, 0, { ok: false, content: 'Error' });
    expect(g.review([read])).toEqual([{ action: 'run' }]);
    g.record(read, 1, { ok: false, content: 'Error' });
    expect(g.review([read])[0]).toMatchObject({
      reason: 'repeated_failure',
    });
  });

  it('skips duplicates within the same turn', () => {
    const verdicts = guard().review([read, read]);
    expect(verdicts[0]).toEqual({ action: 'run' });
    expect(verdicts[1]).toMatchObject({ action: 'skip', reason: 'repeat' });
  });

  it('skips calls beyond the per-turn cap', () => {
    const calls = [1, 2, 3].map((n) => ({
      name: 'code_read',
      arguments: { path: `${n}.ts` },
    }));
    const verdicts = guard(2).review(calls);
    expect(verdicts.map((v) => v.action)).toEqual(['run', 'run', 'skip']);
    expect(verdicts[2]).toMatchObject({ reason: 'round_cap' });
  });

  it('asks for a final answer after repeated refusals', () => {
    const g = guard();
    g.record(read, 0, { ok: true, content: 'x' });
    g.review([read]);
    g.review([read]);
    expect(g.shouldForceFinalAnswer).toBe(false);
    g.review([read]);
    expect(g.shouldForceFinalAnswer).toBe(true);
  });
});
