import { describe, it, expect, beforeEach } from 'vitest';
import { RunEventEmitter } from '../dispatch/events';
import { RunStreamBuffer } from './run-stream-buffer';

const SESSION = 'sess-1';
const RUN = 'run-1';
const AGENT = 'default';

function started(emitter: RunEventEmitter) {
  emitter.emitStarted({
    runId: RUN,
    sessionId: SESSION,
    agentId: AGENT,
    providerId: 'minimax',
    modelId: 'MiniMax-M3',
  });
}

describe('RunStreamBuffer', () => {
  let emitter: RunEventEmitter;
  let buffer: RunStreamBuffer;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    buffer = new RunStreamBuffer(emitter);
    buffer.start();
  });

  it('has nothing to resume before a run starts', () => {
    expect(buffer.getActiveForSession(SESSION)).toBeUndefined();
    expect(buffer.size).toBe(0);
  });

  it('accumulates content, tool calls and activity while a run streams', () => {
    started(emitter);
    emitter.emitDelta({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      content: 'Hello ',
    });
    emitter.emitDelta({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      content: 'world',
    });
    emitter.emitToolCall({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      toolCall: { id: 'tc1', name: 'search', arguments: { q: 'x' } },
    });
    emitter.emitActivity({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      phase: 'running_tool',
      toolName: 'search',
      elapsedMs: 1200,
    });

    const snap = buffer.getActiveForSession(SESSION);
    expect(snap).toBeDefined();
    expect(snap!.runId).toBe(RUN);
    expect(snap!.providerId).toBe('minimax');
    expect(snap!.modelId).toBe('MiniMax-M3');
    // Content is the FULL accumulated text (chunks concatenated).
    expect(snap!.content).toBe('Hello world');
    expect(snap!.toolCalls).toHaveLength(1);
    expect(snap!.toolCalls[0]).toMatchObject({ id: 'tc1', name: 'search' });
    expect(snap!.activity).toEqual({
      phase: 'running_tool',
      toolName: 'search',
      elapsedMs: 1200,
    });
  });

  it('drops the buffer when the run completes', () => {
    started(emitter);
    emitter.emitDelta({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      content: 'partial',
    });
    expect(buffer.getActiveForSession(SESSION)).toBeDefined();

    emitter.emitCompleted({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      finishReason: 'stop',
    });

    expect(buffer.getActiveForSession(SESSION)).toBeUndefined();
    expect(buffer.getRun(RUN)).toBeUndefined();
    expect(buffer.size).toBe(0);
  });

  it('drops the buffer on failure, cancellation, and choices (suspension)', () => {
    for (const emitTerminal of [
      () =>
        emitter.emitFailed({
          runId: RUN,
          sessionId: SESSION,
          agentId: AGENT,
          errorCode: 'boom',
          errorMessage: 'x',
        }),
      () =>
        emitter.emitRunCancelled({
          runId: RUN,
          sessionId: SESSION,
          agentId: AGENT,
        }),
      () =>
        emitter.emitChoices({
          runId: RUN,
          sessionId: SESSION,
          agentId: AGENT,
          choices: ['a', 'b'],
        }),
    ]) {
      started(emitter);
      expect(buffer.getActiveForSession(SESSION)).toBeDefined();
      emitTerminal();
      expect(buffer.getActiveForSession(SESSION)).toBeUndefined();
    }
  });

  it('ignores deltas for a run that never started (no snapshot created)', () => {
    emitter.emitDelta({
      runId: 'ghost',
      sessionId: SESSION,
      agentId: AGENT,
      content: 'orphan',
    });
    expect(buffer.getActiveForSession(SESSION)).toBeUndefined();
    expect(buffer.size).toBe(0);
  });

  it('stops accumulating after stop()', () => {
    buffer.stop();
    started(emitter);
    emitter.emitDelta({
      runId: RUN,
      sessionId: SESSION,
      agentId: AGENT,
      content: 'ignored',
    });
    expect(buffer.getActiveForSession(SESSION)).toBeUndefined();
  });
});
