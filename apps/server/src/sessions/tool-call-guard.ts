import type {
  GuardedToolCall,
  ToolCallGuardOptions,
  ToolCallVerdict,
} from '@openaidy/shared-types';

const PREVIOUS_RESULT_PREVIEW_CHARS = 2_000;
const MAX_IDENTICAL_FAILURES = 2;

type CallRecord = {
  round: number;
  ok: boolean;
  failures: number;
  content: string;
};

/**
 * Stops the two ways a model burns rounds without making progress: calling
 * the same tool with the same arguments when nothing could have changed, and
 * asking for an unbounded batch of calls in a single turn.
 *
 * Repeats are judged against a "nothing changed since" window: any successful
 * call to a tool that isn't read-only clears it, so reading a file again after
 * editing it is still allowed.
 */
export class ToolCallGuard {
  private readonly options: ToolCallGuardOptions;
  private readonly seen = new Map<string, CallRecord>();
  private refusals = 0;

  constructor(options: ToolCallGuardOptions) {
    this.options = options;
  }

  /** True once the model has kept repeating itself despite refusals. */
  get shouldForceFinalAnswer(): boolean {
    return this.refusals >= this.options.maxRefusals;
  }

  /** Decide, in order, which of one turn's calls may run. */
  review(calls: readonly GuardedToolCall[]): ToolCallVerdict[] {
    const keysThisTurn = new Set<string>();
    return calls.map((call, index): ToolCallVerdict => {
      if (index >= this.options.maxCallsPerRound) {
        return {
          action: 'skip',
          reason: 'round_cap',
          content: `Not run: more than ${this.options.maxCallsPerRound} tool calls in one turn. Make the most important calls first, then continue in the next turn if still needed.`,
        };
      }

      const key = toolCallKey(call);
      if (keysThisTurn.has(key)) {
        this.refusals++;
        return {
          action: 'skip',
          reason: 'repeat',
          content: `Not run: identical to another ${call.name} call in this same turn. Use that call's result.`,
        };
      }
      keysThisTurn.add(key);

      const previous = this.seen.get(key);
      if (previous?.ok) {
        this.refusals++;
        const preview =
          previous.content.length > PREVIOUS_RESULT_PREVIEW_CHARS
            ? `${previous.content.slice(0, PREVIOUS_RESULT_PREVIEW_CHARS)}…`
            : previous.content;
        return {
          action: 'skip',
          reason: 'repeat',
          content: `Not run: you already called ${call.name} with these exact arguments (turn ${previous.round + 1}) and nothing has changed since. Reuse that result instead of calling again. Previous result:\n${preview}`,
        };
      }
      if (previous && previous.failures >= MAX_IDENTICAL_FAILURES) {
        this.refusals++;
        return {
          action: 'skip',
          reason: 'repeated_failure',
          content: `Not run: ${call.name} already failed ${previous.failures} times with these exact arguments. Change the arguments or the approach, or tell the user what is blocking you.`,
        };
      }
      return { action: 'run' };
    });
  }

  /** Record the outcome of a call that actually ran. */
  record(
    call: GuardedToolCall,
    round: number,
    result: { ok: boolean; content: string },
  ): void {
    const key = toolCallKey(call);
    if (!result.ok) {
      const previous = this.seen.get(key);
      this.seen.set(key, {
        round,
        ok: false,
        failures: (previous?.failures ?? 0) + 1,
        content: result.content,
      });
      return;
    }
    if (!this.options.isReadOnly(call.name)) {
      this.seen.clear();
    }
    this.seen.set(key, {
      round,
      ok: true,
      failures: 0,
      content: result.content,
    });
  }
}

/** Tool name plus arguments, with object keys sorted so order doesn't matter. */
export function toolCallKey(call: GuardedToolCall): string {
  return `${call.name}\u0000${stableStringify(call.arguments)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
