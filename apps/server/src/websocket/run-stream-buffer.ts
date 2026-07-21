/**
 * Run Stream Buffer
 *
 * Accumulates the live streamed state of in-progress runs (content, tool calls,
 * latest activity) keyed by runId, so a client that reconnects — or returns
 * from a backgrounded tab / screen-off phone — can resume the stream instead of
 * seeing a stalled, empty UI until the run finishes (issue #450).
 *
 * The run itself keeps executing server-side regardless of the socket; this
 * buffer just captures what streamed so far. It is memory-only and short-lived:
 * an entry exists only while its run is in flight and is dropped as soon as the
 * run reaches a terminal event (completed / failed / cancelled / choices).
 */

import type { RunEvent, RunEventEmitter } from '../dispatch/events';

export type BufferedToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type BufferedActivity = {
  phase: 'thinking' | 'running_tool';
  toolName?: string;
  elapsedMs: number;
};

export type BufferedRunSnapshot = {
  runId: string;
  sessionId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  /** Full accumulated assistant text so far (NOT a delta). */
  content: string;
  toolCalls: BufferedToolCall[];
  activity?: BufferedActivity;
};

export class RunStreamBuffer {
  /** runId -> snapshot */
  private readonly runs = new Map<string, BufferedRunSnapshot>();
  /** sessionId -> active runId (one in-flight run per session at a time) */
  private readonly sessionToRun = new Map<string, string>();
  private unsubscribe: (() => void) | undefined = undefined;

  constructor(private readonly runEvents: RunEventEmitter) {}

  /** Begin accumulating from the run event stream. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runEvents.subscribeAll((event) =>
      this.handle(event),
    );
  }

  /** Stop accumulating and drop all buffered state. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.runs.clear();
    this.sessionToRun.clear();
  }

  private handle(event: RunEvent): void {
    switch (event.type) {
      case 'run.started': {
        this.runs.set(event.runId, {
          runId: event.runId,
          sessionId: event.sessionId,
          agentId: event.agentId,
          providerId: (event.data.providerId as string) ?? 'default',
          modelId: (event.data.modelId as string) ?? 'default',
          content: '',
          toolCalls: [],
        });
        this.sessionToRun.set(event.sessionId, event.runId);
        break;
      }
      case 'run.delta': {
        const snap = this.runs.get(event.runId);
        if (!snap) break;
        // delta events carry the chunk in both `delta` and `content`.
        snap.content +=
          (event.data.delta as string | undefined) ??
          (event.data.content as string | undefined) ??
          '';
        break;
      }
      case 'run.tool_call': {
        const snap = this.runs.get(event.runId);
        if (!snap) break;
        const tc = event.data.toolCall as BufferedToolCall | undefined;
        if (tc) snap.toolCalls.push(tc);
        break;
      }
      case 'run.activity': {
        const snap = this.runs.get(event.runId);
        if (!snap) break;
        snap.activity = {
          phase: event.data.phase as BufferedActivity['phase'],
          elapsedMs: event.data.elapsedMs as number,
          ...(event.data.toolName !== undefined && {
            toolName: event.data.toolName as string,
          }),
        };
        break;
      }
      // Terminal events: the run is over (or suspended awaiting the user), so
      // there is nothing left to resume — drop the buffer. The client learns
      // the outcome from the live terminal event or a fresh message fetch.
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled':
      case 'session.run.choices': {
        this.drop(event.runId, event.sessionId);
        break;
      }
      default:
        break;
    }
  }

  private drop(runId: string, sessionId: string): void {
    this.runs.delete(runId);
    if (this.sessionToRun.get(sessionId) === runId) {
      this.sessionToRun.delete(sessionId);
    }
  }

  /** The in-flight run for a session, if any. */
  getActiveForSession(sessionId: string): BufferedRunSnapshot | undefined {
    const runId = this.sessionToRun.get(sessionId);
    return runId ? this.runs.get(runId) : undefined;
  }

  /** A specific run's snapshot, if still in flight. */
  getRun(runId: string): BufferedRunSnapshot | undefined {
    return this.runs.get(runId);
  }

  /** Number of runs currently buffered (for tests / diagnostics). */
  get size(): number {
    return this.runs.size;
  }
}

export function createRunStreamBuffer(
  runEvents: RunEventEmitter,
): RunStreamBuffer {
  return new RunStreamBuffer(runEvents);
}

export default RunStreamBuffer;
