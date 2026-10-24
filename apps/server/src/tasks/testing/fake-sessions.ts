/**
 * Scripted stand-in for SessionMessageService, shared by the workflow
 * engine tests: records every turn and answers with `reply` (step turns)
 * or `verdict` (verification turns), so tests decide what each agent says.
 */

import type { DatabaseAdapter } from '@openaidy/db';

export type Turn = {
  sessionId: string;
  content: string;
  agentId?: string;
  runId?: string;
};
export type Reply = string | { fail: string };

export const VERIFY_PREFIX = 'Evaluate whether this subtask';
export const COMPLETED = '{"verdict": "COMPLETED", "reason": "done"}';

export class FakeSessions {
  readonly turns: Turn[] = [];
  readonly cancelled: string[] = [];
  private readonly messages = new Map<
    string,
    Array<{ role: string; content: string }>
  >();
  private readonly aborters = new Map<string, () => void>();

  /** Agent reply for a step turn (verification turns use `verdict`). */
  reply: (turn: Turn) => Reply | Promise<Reply> = () => 'Done.';
  verdict: (turn: Turn) => Reply | Promise<Reply> = () => COMPLETED;

  constructor(private readonly db: DatabaseAdapter) {}

  async createSession(title: string, type?: 'chat' | 'task' | 'subtask') {
    return this.db.repositories.sessions.create({
      title,
      ...(type ? { type } : {}),
    });
  }

  async listMessages(sessionId: string) {
    return this.messages.get(sessionId) ?? [];
  }

  cancelRun(key: string): boolean {
    this.cancelled.push(key);
    const abort = this.aborters.get(key);
    abort?.();
    return Boolean(abort);
  }

  stepTurns(): Turn[] {
    return this.turns.filter((t) => !t.content.startsWith(VERIFY_PREFIX));
  }

  async submitMessageStreaming(input: {
    sessionId: string;
    content: string;
    agentId?: string;
    runId?: string;
  }) {
    const turn: Turn = {
      sessionId: input.sessionId,
      content: input.content,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
    };
    this.turns.push(turn);
    const log = this.messages.get(input.sessionId) ?? [];
    this.messages.set(input.sessionId, log);
    log.push({ role: 'user', content: input.content });

    let aborted = false;
    const abort = new Promise<'aborted'>((resolve) => {
      if (input.runId) {
        this.aborters.set(input.runId, () => {
          aborted = true;
          resolve('aborted');
        });
      }
    });
    const replyFn = input.content.startsWith(VERIFY_PREFIX)
      ? this.verdict
      : this.reply;
    const result = await Promise.race([Promise.resolve(replyFn(turn)), abort]);
    if (input.runId) this.aborters.delete(input.runId);

    if (aborted || result === 'aborted') {
      return {
        ok: false as const,
        error: { code: 'cancelled', message: 'Run cancelled by user' },
      };
    }
    if (typeof result === 'object') {
      return {
        ok: false as const,
        error: { code: 'provider_error', message: result.fail },
      };
    }
    const assistantMessage = { role: 'assistant', content: result };
    log.push(assistantMessage);
    return {
      ok: true as const,
      userMessage: { role: 'user', content: input.content },
      assistantMessage,
      run: {},
    };
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
