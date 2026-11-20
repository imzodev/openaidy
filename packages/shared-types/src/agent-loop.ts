/**
 * Types for the server's agentic tool-call loop: the guard that stops
 * repeated or runaway tool calls, and context compaction.
 */

/** A tool call as the loop guard sees it. */
export type GuardedToolCall = {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
};

/**
 * What the loop should do with one tool call. `skip` calls are not executed;
 * `content` is returned to the model as that call's result.
 */
export type ToolCallVerdict =
  | { readonly action: 'run' }
  | {
      readonly action: 'skip';
      readonly reason: 'repeat' | 'repeated_failure' | 'round_cap';
      readonly content: string;
    };

export type ToolCallGuardOptions = {
  /** Calls beyond this many in one model turn are skipped. */
  readonly maxCallsPerRound: number;
  /** After this many repeat refusals in a run, the loop forces a final answer. */
  readonly maxRefusals: number;
  /**
   * Whether a tool only reads state. A successful call to any other tool
   * may have changed what reads return, so it resets repeat detection.
   */
  readonly isReadOnly: (toolName: string) => boolean;
};

/** The parts of a persisted session message that compaction reads. */
export type CompactionSourceMessage = {
  readonly role: string;
  readonly content: string;
  readonly sequence: number;
  readonly metadata?: Record<string, unknown> | null | undefined;
};

/** Marks a persisted message as the summary of older turns. */
export const COMPACTION_SUMMARY_KIND = 'compaction_summary';

/** Metadata stored on a compaction summary message. */
export type CompactionSummaryMetadata = {
  readonly kind: typeof COMPACTION_SUMMARY_KIND;
  /** The highest message sequence the summary replaces. */
  readonly coversThroughSequence: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
};
