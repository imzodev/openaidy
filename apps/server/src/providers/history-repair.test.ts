import { describe, it, expect } from 'vitest';
import type { Message } from '@openaidy/runtime';
import { repairProviderHistory } from './history-repair';

const user = (content: string): Message => ({ role: 'user', content });
const system = (content: string): Message => ({ role: 'system', content });
const assistant = (
  content: string,
  toolCalls?: Array<{ id: string; name?: string }>,
): Message => ({
  role: 'assistant',
  content,
  ...(toolCalls
    ? {
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name ?? 'some_tool',
          arguments: '{}',
        })),
      }
    : {}),
});
const tool = (toolCallId: string, content = 'result'): Message => ({
  role: 'tool',
  toolCallId,
  content,
});

describe('repairProviderHistory', () => {
  describe('healthy histories pass through unchanged', () => {
    it('a single resolved tool call keeps toolCalls intact', () => {
      const input = [
        user('hi'),
        assistant('checking', [{ id: 'call_A' }]),
        tool('call_A'),
        assistant('done'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual(input);
      expect(diagnostics).toEqual({
        orphanToolResults: 0,
        strippedToolCallTurns: 0,
        deferredUserMessages: 0,
      });
    });

    // Regression test for the bug in the discarded first attempt at this
    // repair: it decided orphan-vs-complete by checking the pending set
    // BEFORE deleting the id that had just matched, so the set still looked
    // non-empty at the exact moment a multi-tool-call turn was about to
    // resolve completely — stripping toolCalls from a perfectly healthy
    // turn and turning its own tool results into fresh orphans. Reproduced
    // and confirmed against the discarded implementation before writing
    // this one; see the PR description for the reproduction.
    it('parallel tool calls, all resolved, keep toolCalls intact', () => {
      const input = [
        user('hi'),
        assistant('checking two things', [{ id: 'call_A' }, { id: 'call_B' }]),
        tool('call_A', 'result A'),
        tool('call_B', 'result B'),
        assistant('done'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual(input);
      expect(diagnostics.strippedToolCallTurns).toBe(0);
      expect(diagnostics.orphanToolResults).toBe(0);
    });

    it('three-plus parallel tool calls, all resolved, keep toolCalls intact', () => {
      const input = [
        assistant('checking three things', [
          { id: 'call_A' },
          { id: 'call_B' },
          { id: 'call_C' },
        ]),
        tool('call_A'),
        tool('call_B'),
        tool('call_C'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual(input);
      expect(diagnostics.strippedToolCallTurns).toBe(0);
    });

    it('several consecutive resolved tool-call rounds all pass through unchanged', () => {
      const input = [
        user('go'),
        assistant('round 1', [{ id: 'call_A' }, { id: 'call_B' }]),
        tool('call_A'),
        tool('call_B'),
        assistant('round 2', [{ id: 'call_C' }]),
        tool('call_C'),
        assistant('round 3', [{ id: 'call_D' }, { id: 'call_E' }]),
        tool('call_D'),
        tool('call_E'),
        assistant('final answer'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual(input);
      expect(diagnostics.strippedToolCallTurns).toBe(0);
      expect(diagnostics.orphanToolResults).toBe(0);
    });

    it('a plain conversation with no tool calls at all is untouched', () => {
      const input = [system('be nice'), user('hi'), assistant('hello!')];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual(input);
      expect(diagnostics.strippedToolCallTurns).toBe(0);
      expect(diagnostics.orphanToolResults).toBe(0);
      expect(diagnostics.deferredUserMessages).toBe(0);
    });
  });

  describe('genuinely broken histories are repaired', () => {
    it('drops a tool result whose id no assistant ever declared', () => {
      const input = [
        user('hi'),
        assistant('no tools here'),
        tool('call_ghost'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual([user('hi'), assistant('no tools here')]);
      expect(diagnostics.orphanToolResults).toBe(1);
    });

    it('strips toolCalls from a turn interrupted before any result arrives', () => {
      const input = [
        assistant('checking', [{ id: 'call_A' }]),
        user('actually never mind, do something else'),
        assistant('ok'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual([
        assistant('checking'),
        user('actually never mind, do something else'),
        assistant('ok'),
      ]);
      expect(diagnostics.strippedToolCallTurns).toBe(1);
      expect(diagnostics.orphanToolResults).toBe(0);
    });

    it('strips toolCalls AND drops the already-matched result when only some of a parallel turn resolves', () => {
      const input = [
        assistant('checking two things', [{ id: 'call_A' }, { id: 'call_B' }]),
        tool('call_A', 'result A'), // B's result never arrives
        user('never mind'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      // result A would orphan itself if kept (the stripped assistant no
      // longer declares call_A), so it must be dropped along with the strip.
      expect(messages).toEqual([
        assistant('checking two things'),
        user('never mind'),
      ]);
      expect(diagnostics.strippedToolCallTurns).toBe(1);
      expect(diagnostics.orphanToolResults).toBe(1);
    });

    it('strips a trailing unresolved tool-call turn at end of history', () => {
      const input = [user('hi'), assistant('checking', [{ id: 'call_A' }])];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual([user('hi'), assistant('checking')]);
      expect(diagnostics.strippedToolCallTurns).toBe(1);
    });

    it('a new tool-calling turn abandons an unresolved previous one', () => {
      const input = [
        assistant('first', [{ id: 'call_A' }]),
        assistant('second', [{ id: 'call_B' }]),
        tool('call_B'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual([
        assistant('first'),
        assistant('second', [{ id: 'call_B' }]),
        tool('call_B'),
      ]);
      expect(diagnostics.strippedToolCallTurns).toBe(1);
    });
  });

  describe('mid-turn user messages are deferred, not dropped', () => {
    it('defers a user message that arrives while a tool call is in flight', () => {
      const input = [
        assistant('checking', [{ id: 'call_A' }]),
        user('any update?'),
        tool('call_A'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual([
        assistant('checking', [{ id: 'call_A' }]),
        tool('call_A'),
        user('any update?'),
      ]);
      expect(diagnostics.deferredUserMessages).toBe(1);
      expect(diagnostics.strippedToolCallTurns).toBe(0);
    });

    it('preserves the order of multiple deferred user messages', () => {
      const input = [
        assistant('checking', [{ id: 'call_A' }, { id: 'call_B' }]),
        user('first interjection'),
        tool('call_A'),
        user('second interjection'),
        tool('call_B'),
      ];
      const { messages } = repairProviderHistory(input);
      expect(messages).toEqual([
        assistant('checking', [{ id: 'call_A' }, { id: 'call_B' }]),
        tool('call_A'),
        tool('call_B'),
        user('first interjection'),
        user('second interjection'),
      ]);
    });
  });

  describe('purity', () => {
    it('never mutates the input array or its messages', () => {
      const input = Object.freeze([
        Object.freeze(assistant('checking', [{ id: 'call_A' }])),
        Object.freeze(tool('call_A')),
      ]);
      expect(() => repairProviderHistory(input)).not.toThrow();
    });

    it('same input produces the same output on repeated calls', () => {
      const input = [
        assistant('checking two things', [{ id: 'call_A' }, { id: 'call_B' }]),
        tool('call_A'),
        tool('call_B'),
      ];
      const first = repairProviderHistory(input);
      const second = repairProviderHistory(input);
      expect(first).toEqual(second);
    });
  });

  describe('real-world reproduction (MiniMax error 2013)', () => {
    // The exact shape that triggered `invalid params, tool result's tool
    // id(...) not found (2013)` in production: a healthy, already-persisted
    // history — several rounds, some with parallel tool calls — that must
    // reach the provider byte-for-byte unchanged. Pulled from the actual
    // session structure (ids shortened for readability).
    it('passes a realistic multi-round session through unchanged', () => {
      const input: Message[] = [
        user('fix my price-comparison addon'),
        assistant('let me look', [
          { id: 'call_1', name: 'workspace_list' },
          { id: 'call_2', name: 'code_glob' },
        ]),
        tool('call_1', 'listing'),
        tool('call_2', 'glob results'),
        assistant('reading the addon', [{ id: 'call_3', name: 'code_read' }]),
        tool('call_3', 'file contents'),
        assistant('here is what I found'),
        user('yes, please fix it'),
        assistant('applying the fix', [
          { id: 'call_4', name: 'code_edit' },
          { id: 'call_5', name: 'addon_update' },
          { id: 'call_6', name: 'addon_run' },
        ]),
        tool('call_4', 'edited'),
        tool('call_5', 'updated'),
        tool('call_6', 'ran'),
        assistant('done, try it now'),
      ];
      const { messages, diagnostics } = repairProviderHistory(input);
      expect(messages).toEqual(input);
      expect(diagnostics).toEqual({
        orphanToolResults: 0,
        strippedToolCallTurns: 0,
        deferredUserMessages: 0,
      });
    });
  });
});
