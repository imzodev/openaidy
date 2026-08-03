/**
 * Provider history repair.
 *
 * Every OpenAI-compatible provider (OpenAI, MiniMax, DeepSeek, …) rejects a
 * request with a 400 if a `role: 'tool'` message's `tool_call_id` is not
 * declared by an immediately-preceding `role: 'assistant'` message's
 * `toolCalls`. MiniMax's exact wording is `invalid params, tool result's
 * tool id(<id>) not found (2013)`.
 *
 * The persisted transcript can develop exactly this shape in the wild:
 *
 *   - A user message arrives while a slow tool call is still in flight
 *     (the tool blocks for tens of seconds and the user sends "continue" or
 *     a new instruction before it resolves).
 *   - A tool result is never persisted — a crash, an aborted run, or a bug
 *     elsewhere leaves an assistant's `toolCalls` declared with no matching
 *     `tool` row.
 *
 * This module repairs the in-memory history immediately before it leaves
 * the server, so a malformed transcript degrades gracefully (the offending
 * assistant turn becomes plain text) instead of taking every future request
 * on that session down with a 400.
 *
 * Algorithm: a `role: 'assistant'` message with `toolCalls` opens a group.
 * Every message is buffered until the group is *closed* — either because
 * every declared id has a matching `tool` result, or because a
 * non-matching message (system, plain assistant, a new tool-calling
 * assistant, or end of input) forces the question. The close decision reads
 * the FINAL state of the group, once, and is the only place `toolCalls` can
 * be stripped. This point matters: an earlier version of this repair made
 * that decision on every partial match (the moment the *first* of several
 * parallel tool results arrived), while the group's pending set still held
 * the other ids — so it stripped `toolCalls` from a turn that was, in fact,
 * about to resolve completely. A single-tool-call turn is a degenerate case
 * of the same bug: nothing distinguishes "the last id is about to be
 * deleted" from "no id will ever be deleted" if you check before deleting.
 * Deciding once, from the final state, has no such window.
 */
import {
  isAssistantMessage,
  isToolResultMessage,
  isUserMessage,
  type AssistantMessage,
  type Message,
  type ToolResultMessage,
} from '@openaidy/runtime';

export type ProviderHistoryRepair = {
  messages: Message[];
  diagnostics: {
    /** Tool results whose id no assistant turn declared. Dropped. */
    orphanToolResults: number;
    /**
     * Assistant turns whose `toolCalls` were stripped because one or more
     * declared ids never got a matching result.
     */
    strippedToolCallTurns: number;
    /** User messages deferred from inside a tool turn to right after it. */
    deferredUserMessages: number;
  };
};

/** A message this module never needs to look inside; passed through as-is. */
type OtherMessage = Exclude<Message, AssistantMessage | ToolResultMessage>;

type PendingGroup = {
  assistant: AssistantMessage;
  /** Declared tool_call ids not yet matched by a result. */
  pendingIds: Set<string>;
  /** Results matched so far, in arrival order. */
  matchedTools: ToolResultMessage[];
};

/**
 * Reconstruct a provider-ready history from a possibly-malformed one.
 *
 * Pure function — same input produces the same output, the input array and
 * its messages are never mutated, and relative order is preserved except for
 * the deferral described above.
 */
export function repairProviderHistory(
  messages: readonly Message[],
): ProviderHistoryRepair {
  const result: Message[] = [];
  const deferredUsers: Message[] = [];
  let pending: PendingGroup | undefined;

  let orphanToolResults = 0;
  let strippedToolCallTurns = 0;
  let deferredUserMessages = 0;

  const hasDeclaredToolCalls = (
    msg: AssistantMessage,
  ): msg is AssistantMessage & { toolCalls: readonly { id: string }[] } =>
    (msg.toolCalls?.length ?? 0) > 0;

  /**
   * Settle the pending group, if any: emit it complete (unchanged) when
   * every declared id was matched, or with `toolCalls` stripped — and its
   * matched results dropped, since they would otherwise cite ids the
   * stripped assistant no longer declares — when it was not.
   */
  function closePendingGroup(): void {
    if (!pending) return;
    if (pending.pendingIds.size === 0) {
      result.push(pending.assistant, ...pending.matchedTools);
    } else {
      result.push(stripToolCalls(pending.assistant));
      strippedToolCallTurns++;
      orphanToolResults += pending.matchedTools.length;
    }
    pending = undefined;
  }

  function flushDeferredUsers(): void {
    if (deferredUsers.length === 0) return;
    result.push(...deferredUsers);
    deferredUsers.length = 0;
  }

  for (const msg of messages) {
    if (isAssistantMessage(msg) && hasDeclaredToolCalls(msg)) {
      // A new tool-calling turn begins; anything still pending from a prior
      // turn is now provably abandoned (nothing else could have matched it).
      closePendingGroup();
      pending = {
        assistant: msg,
        pendingIds: new Set(msg.toolCalls.map((tc) => tc.id)),
        matchedTools: [],
      };
      continue;
    }

    if (isToolResultMessage(msg)) {
      if (pending?.pendingIds.has(msg.toolCallId)) {
        pending.pendingIds.delete(msg.toolCallId);
        pending.matchedTools.push(msg);
        // All declared ids matched — the group can only get more complete
        // from here, so settle now rather than waiting for the next message
        // (which may never come, if this was the last turn in the array).
        if (pending.pendingIds.size === 0) closePendingGroup();
      } else {
        // No open group declares this id — a genuinely unrelated or
        // already-resolved result. The provider would reject it outright.
        orphanToolResults++;
      }
      continue;
    }

    if (isUserMessage(msg) && pending) {
      // Arrived mid-turn (a slow tool call still in flight). Hold it so the
      // eventual tool_call/tool_result adjacency is unbroken; re-emit right
      // after the group settles, preserving relative order among deferrals.
      deferredUsers.push(msg);
      deferredUserMessages++;
      continue;
    }

    // System, plain-text assistant, or a user message with nothing pending:
    // this message can't belong to an open group, so settle it first.
    closePendingGroup();
    flushDeferredUsers();
    result.push(msg as OtherMessage);
  }

  closePendingGroup();
  flushDeferredUsers();

  return {
    messages: result,
    diagnostics: {
      orphanToolResults,
      strippedToolCallTurns,
      deferredUserMessages,
    },
  };
}

/**
 * Copy of an assistant message with `toolCalls` removed, so the provider
 * sees a plain text turn instead of a dangling declaration. Every other
 * field (`reasoningContent`, etc.) is preserved.
 */
function stripToolCalls(msg: AssistantMessage): AssistantMessage {
  const { toolCalls: _toolCalls, ...rest } = msg;
  return rest;
}
