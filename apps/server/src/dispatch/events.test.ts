import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunEventEmitter } from './events.js';
import type { ChoicesEvent } from '@openaidy/shared-types';

describe('RunEventEmitter', () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
  });

  describe('emitChoices', () => {
    it('publishes a session.run.choices event with correct payload', () => {
      const listener = vi.fn();
      emitter.subscribe('run-1', listener);

      emitter.emitChoices({
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        question: 'Pick a tone',
        choices: ['Direct', 'Warm', 'Formal'],
      });

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0]![0] as {
        type: string;
        data: ChoicesEvent;
      };
      expect(event.type).toBe('session.run.choices');
      expect(event.data).toBeDefined();
      const payload = event.data as ChoicesEvent;
      expect(payload.choices).toEqual(['Direct', 'Warm', 'Formal']);
    });

    it('includes runId, sessionId, and agentId in the event', () => {
      const listener = vi.fn();
      emitter.subscribe('run-abc', listener);

      emitter.emitChoices({
        runId: 'run-abc',
        sessionId: 'session-xyz',
        agentId: 'agent-1',
        choices: ['A', 'B'],
      });

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0]![0] as {
        runId: string;
        sessionId: string;
        agentId: string;
        type: string;
      };
      expect(event.runId).toBe('run-abc');
      expect(event.sessionId).toBe('session-xyz');
      expect(event.agentId).toBe('agent-1');
      expect(event.type).toBe('session.run.choices');
    });

    it('works without a question', () => {
      const listener = vi.fn();
      emitter.subscribe('run-1', listener);

      emitter.emitChoices({
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        choices: ['Yes', 'No'],
      });

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0]![0] as {
        type: string;
        data: ChoicesEvent;
      };
      expect(event.type).toBe('session.run.choices');
      expect(event.data).toBeDefined();
      const payload = event.data as ChoicesEvent;
      expect((payload as { question?: string }).question).toBeUndefined();
      expect(payload.choices).toEqual(['Yes', 'No']);
    });
  });

  describe('emitActivity', () => {
    it('publishes a run.activity event with phase, tool name, and elapsed', () => {
      const listener = vi.fn();
      emitter.subscribe('run-1', listener);

      emitter.emitActivity({
        runId: 'run-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        phase: 'running_tool',
        toolName: 'exec_run',
        elapsedMs: 12000,
      });

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0]![0] as {
        type: string;
        runId: string;
        data: { phase: string; toolName?: string; elapsedMs: number };
      };
      expect(event.type).toBe('run.activity');
      expect(event.runId).toBe('run-1');
      expect(event.data.phase).toBe('running_tool');
      expect(event.data.toolName).toBe('exec_run');
      expect(event.data.elapsedMs).toBe(12000);
    });

    it('omits toolName when not provided (thinking phase)', () => {
      const listener = vi.fn();
      emitter.subscribe('run-2', listener);

      emitter.emitActivity({
        runId: 'run-2',
        sessionId: 'session-1',
        agentId: 'agent-1',
        phase: 'thinking',
        elapsedMs: 500,
      });

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0]![0] as {
        data: { phase: string; toolName?: string };
      };
      expect(event.data.phase).toBe('thinking');
      expect(event.data.toolName).toBeUndefined();
    });
  });
});
