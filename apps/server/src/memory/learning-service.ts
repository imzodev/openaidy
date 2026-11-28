import type { MemoryLearningCandidate } from '@aidyagent/shared-types';
import type { MemoryLearningServiceDeps } from '../types.js';
import { renderTranscript } from '../sessions/compaction.js';
import { stripThinking } from '../lib/message.js';
import {
  LEARNING_INSTRUCTIONS,
  MAX_EXISTING_FACTS,
  applyLearningOps,
  buildLearningRequest,
  parseLearningOps,
  selectLearnableMessages,
} from './learning.js';

/** How often to look for conversations to learn from. */
export const LEARNING_SWEEP_MS = 5 * 60_000;
/** A conversation is read once it has been quiet this long. */
export const LEARNING_IDLE_MS = 10 * 60_000;
/** Conversations older than this are never read (no backlog on upgrade). */
export const LEARNING_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** Conversations read per sweep, so a backlog is spread out. */
const SESSIONS_PER_SWEEP = 5;
/** Transcript sent to the extractor, newest part kept. */
const MAX_TRANSCRIPT_CHARS = 24_000;
/** After this many failed attempts a conversation is skipped. */
const MAX_ATTEMPTS = 3;

/**
 * Learns about the owner in the background. Every few minutes it reads
 * conversations with the owner that went quiet, asks the conversation's
 * own model what they taught about the owner, and saves that to the shared
 * owner memory every agent sees. Customer chats and scheduler-started
 * turns are never read. Failures are logged and never reach a user.
 */
export class MemoryLearningService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private sweeping = false;
  private readonly failures = new Map<string, number>();

  constructor(private readonly deps: MemoryLearningServiceDeps) {}

  start(): void {
    this.timer ??= setInterval(() => void this.sweep(), LEARNING_SWEEP_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over the conversations waiting to be read. */
  async sweep(): Promise<void> {
    if (this.sweeping || !this.deps.isEnabled()) return;
    this.sweeping = true;
    try {
      const now = (this.deps.now?.() ?? new Date()).getTime();
      const candidates = await this.deps.learningState.findCandidates({
        idleBefore: new Date(now - LEARNING_IDLE_MS).toISOString(),
        activeAfter: new Date(now - LEARNING_LOOKBACK_MS).toISOString(),
        limit: SESSIONS_PER_SWEEP,
      });
      for (const candidate of candidates) {
        await this.learnFrom(candidate);
      }
    } catch (err) {
      this.deps.logger.warn('Memory learning sweep failed', { err });
    } finally {
      this.sweeping = false;
    }
  }

  private async learnFrom(candidate: MemoryLearningCandidate): Promise<void> {
    const { sessionId, lastSequence } = candidate;
    const done = () =>
      this.deps.learningState.setCursor(sessionId, lastSequence);

    if (await this.deps.isCustomerSession(sessionId)) {
      await done();
      return;
    }

    const messages = await this.deps.sessionMessages.listBySession(sessionId);
    const learnable = selectLearnableMessages(
      messages,
      candidate.throughSequence,
    );
    const run = await this.deps.sessionRuns.getLatest(sessionId);
    if (!run || !learnable.some((m) => m.role === 'user')) {
      await done();
      return;
    }

    const known = await this.deps.memories.listOwner(MAX_EXISTING_FACTS);
    const result = await this.deps.complete(
      {
        system: LEARNING_INSTRUCTIONS,
        user: buildLearningRequest(
          known,
          renderTranscript(learnable, MAX_TRANSCRIPT_CHARS),
        ),
        maxTokens: 1_024,
      },
      { providerId: run.providerId, modelId: run.modelId },
    );

    const ops = result.ok ? parseLearningOps(stripThinking(result.text)) : null;
    if (!ops) {
      const attempts = (this.failures.get(sessionId) ?? 0) + 1;
      this.deps.logger.warn('Could not learn from a conversation', {
        sessionId,
        attempts,
        error: result.ok ? 'answer was not valid JSON' : result.error,
      });
      if (attempts < MAX_ATTEMPTS) {
        this.failures.set(sessionId, attempts);
        return;
      }
      // Give up on this stretch rather than retrying it forever.
      this.failures.delete(sessionId);
      await done();
      return;
    }

    this.failures.delete(sessionId);
    const outcome = await applyLearningOps({
      ops,
      known,
      memories: this.deps.memories,
      sessionId,
    });
    await done();
    if (outcome.added || outcome.updated || outcome.forgotten) {
      this.deps.logger.info('Learned about the owner', {
        sessionId,
        ...outcome,
      });
    }
  }
}
