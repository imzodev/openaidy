import { EventEmitter } from 'eventemitter3';
import type { ChoicesEvent } from '@openaidy/shared-types';

/**
 * Run event types
 */
export type RunEventType =
  | 'run.queued'
  | 'run.started'
  | 'run.delta'
  | 'run.completed'
  | 'run.failed'
  | 'session.run.choices';

/**
 * Run event envelope
 */
export type RunEvent = {
  type: RunEventType;
  runId: string;
  sessionId: string;
  agentId: string;
  timestamp: string;
  data: Record<string, unknown>;
};

/**
 * Run event emitter options
 */
export type RunEventEmitterOptions = {
  /** Max listeners per run (default: 10) */
  maxListeners?: number;
};

/**
 * Run event emitter
 *
 * Provides event-based streaming for run execution.
 * Each run has its own event channel, enabling concurrent runs.
 */
export class RunEventEmitter {
  private readonly emitter: EventEmitter;
  private readonly maxListeners: number;

  constructor(options: RunEventEmitterOptions = {}) {
    this.emitter = new EventEmitter();
    this.maxListeners = options.maxListeners ?? 10;
  }

  /**
   * Get the event name for a run
   */
  private getRunChannel(runId: string): string {
    return `run:${runId}`;
  }

  /**
   * Subscribe to events for a specific run
   *
   * Returns an unsubscribe function.
   */
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const channel = this.getRunChannel(runId);

    // Track listener count
    const currentCount = this.emitter.listenerCount(channel);
    if (currentCount >= this.maxListeners) {
      console.warn(
        `RunEventEmitter: Max listeners (${this.maxListeners}) reached for run ${runId}`,
      );
    }

    this.emitter.on(channel, listener);

    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Emit an event for a run
   */
  emit(event: RunEvent): void {
    const channel = this.getRunChannel(event.runId);
    this.emitter.emit(channel, event);
  }

  /**
   * Emit a run.queued event
   */
  emitQueued(params: {
    runId: string;
    sessionId: string;
    agentId: string;
  }): void {
    this.emit({
      type: 'run.queued',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: {},
    });
  }

  /**
   * Emit a run.started event
   */
  emitStarted(params: {
    runId: string;
    sessionId: string;
    agentId: string;
    providerId: string;
    modelId: string;
  }): void {
    this.emit({
      type: 'run.started',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: {
        providerId: params.providerId,
        modelId: params.modelId,
      },
    });
  }

  /**
   * Emit a run.delta event (streaming chunk)
   */
  emitDelta(params: {
    runId: string;
    sessionId: string;
    agentId: string;
    content: string;
    delta?: string;
  }): void {
    this.emit({
      type: 'run.delta',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: {
        content: params.content,
        delta: params.delta ?? params.content,
      },
    });
  }

  /**
   * Emit a run.tool_call event (tool execution during streaming)
   */
  emitToolCall(params: {
    runId: string;
    sessionId: string;
    agentId: string;
    toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  }): void {
    this.emit({
      type: 'run.delta',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: {
        toolCall: params.toolCall,
      },
    });
  }

  /**
   * Emit a run.completed event
   */
  emitCompleted(params: {
    runId: string;
    sessionId: string;
    agentId: string;
    finishReason: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }): void {
    this.emit({
      type: 'run.completed',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: {
        finishReason: params.finishReason,
        usage: params.usage,
      },
    });
  }

  /**
   * Emit a run.failed event
   */
  emitFailed(params: {
    runId: string;
    sessionId: string;
    agentId: string;
    errorCode: string;
    errorMessage: string;
  }): void {
    this.emit({
      type: 'run.failed',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: {
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      },
    });
  }

  /**
   * Emit a session.run.choices event
   */
  emitChoices(params: {
    runId: string;
    sessionId: string;
    agentId: string;
    question?: string;
    choices: string[];
  }): void {
    const payload: ChoicesEvent = {
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      ...(params.question !== undefined ? { question: params.question } : {}),
      choices: params.choices,
    };
    this.emit({
      type: 'session.run.choices',
      runId: params.runId,
      sessionId: params.sessionId,
      agentId: params.agentId,
      timestamp: new Date().toISOString(),
      data: payload,
    });
  }

  /**
   * Remove all listeners for a run
   */
  clear(runId: string): void {
    const channel = this.getRunChannel(runId);
    this.emitter.removeAllListeners(channel);
  }

  /**
   * Get the number of listeners for a run
   */
  listenerCount(runId: string): number {
    return this.emitter.listenerCount(this.getRunChannel(runId));
  }
}

/**
 * Global run event emitter instance
 */
export const runEvents = new RunEventEmitter();

/**
 * Format an event for SSE
 */
export function formatSSE(event: RunEvent): string {
  const eventStr = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  return eventStr;
}
