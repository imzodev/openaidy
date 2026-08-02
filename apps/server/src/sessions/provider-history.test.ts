import { describe, it, expect } from 'vitest';
import type { Message } from '@openaidy/runtime';
import { reconstructProviderHistory } from './provider-history.js';

// ---------------------------------------------------------------------------
// Test fixtures — typed loosely so each case reads as the scenario, not as
// verbose constructor calls. The reconstruction function only reads the
// fields it needs; TypeScript widens to Message at the call site.
// ---------------------------------------------------------------------------

type ToolCall = { id: string; name: string; arguments: string };

const tc = (id: string): ToolCall => ({ id, name: 'noop', arguments: '{}' });

const assistantText = (content: string): Message =>
  ({ role: 'assistant', content }) as Message;

const assistantWithTools = (content: string, toolCalls: ToolCall[]): Message =>
  ({ role: 'assistant', content, toolCalls }) as Message;

const toolResult = (id: string, content = '{}'): Message =>
  ({ role: 'tool', toolCallId: id, content }) as Message;

const user = (content: string): Message => ({ role: 'user', content });

const system = (content: string): Message => ({ role: 'system', content });

// ---------------------------------------------------------------------------

describe('reconstructProviderHistory', () => {
  it('returns an empty array for empty input', () => {
    const r = reconstructProviderHistory([]);
    expect(r.messages).toEqual([]);
    expect(r.diagnostics).toEqual({
      orphanToolMessages: 0,
      strippedToolCalls: 0,
      deferredUserMessages: 0,
    });
  });

  it('passes through plain conversation unchanged', () => {
    const input: Message[] = [
      system('you are helpful'),
      user('hi'),
      assistantText('hello'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual(input);
    expect(r.diagnostics).toEqual({
      orphanToolMessages: 0,
      strippedToolCalls: 0,
      deferredUserMessages: 0,
    });
  });

  it('keeps assistant tool_calls + tool results contiguous when no user message intervenes', () => {
    const input: Message[] = [
      assistantWithTools('call a', [tc('a')]),
      toolResult('a'),
      assistantText('done'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual(input);
  });

  // ---------------------------------------------------------------------------
  // The bug from the user report: a user message arrived between the
  // assistant's tool_call and the tool result, breaking provider adjacency.
  // ---------------------------------------------------------------------------
  it('defers a user message that arrived between tool_call and tool result', () => {
    const input: Message[] = [
      assistantWithTools('executing', [tc('a')]),
      user('continue please'),
      toolResult('a', 'result-A'),
      assistantText('done'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      assistantWithTools('executing', [tc('a')]),
      toolResult('a', 'result-A'),
      user('continue please'),
      assistantText('done'),
    ]);
    expect(r.diagnostics.deferredUserMessages).toBe(1);
  });

  it('defers multiple user messages that arrived during a tool turn, preserving order', () => {
    const input: Message[] = [
      assistantWithTools('executing', [tc('a')]),
      user('first interrupt'),
      user('second interrupt'),
      toolResult('a'),
      assistantText('done'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      assistantWithTools('executing', [tc('a')]),
      toolResult('a'),
      user('first interrupt'),
      user('second interrupt'),
      assistantText('done'),
    ]);
    expect(r.diagnostics.deferredUserMessages).toBe(2);
  });

  it('does NOT defer a user message that arrived after the tool result', () => {
    const input: Message[] = [
      assistantWithTools('executing', [tc('a')]),
      toolResult('a'),
      user('after the tool'),
      assistantText('done'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual(input);
    expect(r.diagnostics.deferredUserMessages).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Parallel tool calls: user arrives while two tools are in flight.
  // ---------------------------------------------------------------------------
  it('defers user message until ALL pending tool results are answered', () => {
    const input: Message[] = [
      assistantWithTools('parallel', [tc('a'), tc('b')]),
      toolResult('a'),
      user('hurry up'),
      toolResult('b'),
      assistantText('done'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      assistantWithTools('parallel', [tc('a'), tc('b')]),
      toolResult('a'),
      toolResult('b'),
      user('hurry up'),
      assistantText('done'),
    ]);
  });

  // ---------------------------------------------------------------------------
  // Orphan handling: assistant emitted tool_calls but the result was never
  // persisted (crash, abort, DB write failure). Without repair the provider
  // would see dangling tool_calls. We strip them.
  // ---------------------------------------------------------------------------
  it('strips tool_calls from an orphan assistant with no tool result', () => {
    const orphan = assistantWithTools('will this ever run?', [tc('x')]);
    const input: Message[] = [orphan, assistantText('moving on')];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      assistantText('will this ever run?'),
      assistantText('moving on'),
    ]);
    expect(r.diagnostics.strippedToolCalls).toBe(1);
  });

  it('strips tool_calls from a trailing orphan at the end of the history', () => {
    const input: Message[] = [
      assistantText('earlier turn'),
      assistantWithTools('did this finish?', [tc('x')]),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      assistantText('earlier turn'),
      assistantText('did this finish?'),
    ]);
    expect(r.diagnostics.strippedToolCalls).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Orphan tool message: tool result whose tool_call_id doesn't match any
  // pending tool_call. Defensive — under normal persistence this never
  // happens, but a corrupted DB row would otherwise cause the provider to
  // see a tool with no preceding assistant.
  // ---------------------------------------------------------------------------
  it('drops a tool message whose tool_call_id does not match any pending tool', () => {
    const input: Message[] = [
      assistantText('hello'),
      toolResult('unknown-id'),
      user('hi'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([assistantText('hello'), user('hi')]);
    expect(r.diagnostics.orphanToolMessages).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Multi-run / multi-turn history: a sequence of past runs followed by
  // the current run's user message must stay in order, with each turn
  // internally well-formed.
  // ---------------------------------------------------------------------------
  it('reorders a multi-run history where a slow tool in run A had a user message interleaved', () => {
    const input: Message[] = [
      // Run 1
      assistantWithTools('a1', [tc('a1')]),
      user('continue (during run 1)'),
      toolResult('a1', 'r1'),
      assistantText('done with run 1'),
      // Run 2: user message between runs
      user('start run 2'),
      assistantWithTools('a2', [tc('a2')]),
      toolResult('a2', 'r2'),
      assistantText('done with run 2'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      // Run 1, repaired
      assistantWithTools('a1', [tc('a1')]),
      toolResult('a1', 'r1'),
      user('continue (during run 1)'),
      assistantText('done with run 1'),
      // Run 2
      user('start run 2'),
      assistantWithTools('a2', [tc('a2')]),
      toolResult('a2', 'r2'),
      assistantText('done with run 2'),
    ]);
    expect(r.diagnostics.deferredUserMessages).toBe(1);
  });

  it('handles empty tool_calls array on an assistant as a plain text reply (no orphan count)', () => {
    const input: Message[] = [
      {
        role: 'assistant',
        content: 'thinking out loud',
        toolCalls: [],
      } as Message,
      user('ok?'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual(input);
    expect(r.diagnostics.strippedToolCalls).toBe(0);
  });

  it('does not mutate the input array', () => {
    const a = assistantWithTools('a', [tc('a')]);
    const u = user('mid');
    const t = toolResult('a');
    const input: Message[] = [a, u, t];
    const snapshot = JSON.parse(JSON.stringify(input));
    reconstructProviderHistory(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('preserves reasoning content on a successful assistant turn', () => {
    const input: Message[] = [
      {
        role: 'assistant',
        content: 'answer',
        reasoningContent: 'I thought about it',
      } as Message,
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual(input);
  });

  it('strips tool_calls but preserves reasoningContent on an orphan assistant', () => {
    const input: Message[] = [
      {
        role: 'assistant',
        content: 'orphan',
        toolCalls: [tc('x')],
        reasoningContent: 'reasoning kept',
      } as Message,
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      {
        role: 'assistant',
        content: 'orphan',
        reasoningContent: 'reasoning kept',
      } as Message,
    ]);
    expect(r.diagnostics.strippedToolCalls).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Real-world reproduction of the user's session: the exact shape that
  // produced the 2013 error.
  // ---------------------------------------------------------------------------
  it('repairs the user-reported 2013 case (user message inside a tool turn)', () => {
    // The persisted history (in sequence order) looked like:
    //   assistant (PuckLw2v, tool_calls=[call_function_zc...])
    //   user (no run, "continue")
    //   tool (PuckLw2v, tool_call_id=call_function_zc...)
    //   assistant (PuckLw2v, text)
    const input: Message[] = [
      assistantWithTools('buscando el screenshot', [
        tc('call_function_zc61tnir7t5k_1'),
      ]),
      user('continue'),
      toolResult('call_function_zc61tnir7t5k_1', 'exit code: 1'),
      assistantText('sigo buscando'),
    ];
    const r = reconstructProviderHistory(input);
    expect(r.messages).toEqual([
      assistantWithTools('buscando el screenshot', [
        tc('call_function_zc61tnir7t5k_1'),
      ]),
      toolResult('call_function_zc61tnir7t5k_1', 'exit code: 1'),
      user('continue'),
      assistantText('sigo buscando'),
    ]);
    expect(r.diagnostics.deferredUserMessages).toBe(1);
    expect(r.diagnostics.strippedToolCalls).toBe(0);
    expect(r.diagnostics.orphanToolMessages).toBe(0);
  });
});
