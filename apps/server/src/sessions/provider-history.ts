/**
 * Provider history reconstruction.
 *
 * Provider APIs (OpenAI, MiniMax, Anthropic, Gemini) require that every
 * `role: 'tool'` message in the conversation history immediately follow the
 * `role: 'assistant'` message whose `tool_calls` array contains the
 * matching `tool_call_id`. Anything that intervenes (typically a user
 * message that arrived while a slow tool was still in flight, or a tool
 * whose result was never persisted) causes the entire request to be
 * rejected with a 400-level error such as
 * `400 invalid params, tool call result does not follow tool call`.
 *
 * This module repairs the in-memory history before it leaves the server.
 * The transformation is a pure function so it is trivial to unit-test
 * against the failure modes the database can produce in the wild
 * (see provider-history.test.ts).
 *
 * The repairs performed, in order:
 *
 *   1. **Orphan tool**: a `role: 'tool'` message whose `tool_call_id` does
 *      not match any pending `tool_calls` is dropped. (Defensive — under
 *      normal persistence this never happens.)
 *
 *   2. **Orphan tool_call**: an `role: 'assistant'` message whose
 *      `tool_calls` were never followed by a matching `role: 'tool'`
 *      result has its `tool_calls` stripped so the provider treats it as
 *      a plain text reply. The assistant is emitted first (with the
 *      orphan `tool_calls` removed) before the next message, preserving
 *      relative order.
 *
 *   3. **Mid-turn user message**: a `role: 'user'` message that arrived
 *      while one or more `tool_calls` were still pending is deferred and
 *      re-emitted immediately after the last pending tool result. The
 *      user's content and attachments are preserved verbatim, in
 *      original order.
 *
 *   4. **All other messages** (system, plain assistant text, user
 *      messages between runs) pass through unchanged.
 *
 * The original message order is otherwise preserved. Messages that are
 * not relevant to tool-call adjacency (system prompts, plain assistant
 * text, user messages) are never reordered.
 */
import type { Message, MessageRole } from '@openaidy/runtime';

/**
 * Public result type: the repaired history plus non-fatal diagnostics
 * the caller may log. Diagnostics are an implementation detail of the
 * sanitization pass; the only field the model request actually needs
 * is `messages`.
 */
export type ReconstructedHistory = {
  messages: Message[];
  diagnostics: {
    /** Number of tool messages dropped because they had no matching tool_call. */
    orphanToolMessages: number;
    /** Number of assistant messages whose `tool_calls` were stripped for having no tool result. */
    strippedToolCalls: number;
    /** Number of user messages deferred from inside a tool turn to after it. */
    deferredUserMessages: number;
  };
};

/**
 * Reconstruct a provider-ready history from a possibly-malformed one.
 *
 * Pure function: same input -> same output, no I/O, no mutation of the
 * input array.
 */
export function reconstructProviderHistory(
  messages: readonly Message[],
): ReconstructedHistory {
  const result: Message[] = [];
  const deferredUsers: Message[] = [];
  let bufferedAssistant: Message | undefined;
  let pendingToolIds = new Set<string>();
  let orphanToolMessages = 0;
  let strippedToolCalls = 0;
  let deferredUserMessages = 0;

  const flushDeferredUsers = () => {
    if (deferredUsers.length === 0) return;
    for (const user of deferredUsers) result.push(user);
    deferredUsers.length = 0;
  };

  const flushBufferedAssistant = () => {
    if (!bufferedAssistant) return;
    if (pendingToolIds.size > 0) {
      // Orphan: strip tool_calls, re-emit as a plain text assistant turn.
      result.push(stripToolCalls(bufferedAssistant));
      strippedToolCalls++;
    } else {
      result.push(bufferedAssistant);
    }
    bufferedAssistant = undefined;
    pendingToolIds = new Set();
  };

  for (const msg of messages) {
    const role: MessageRole = msg.role;
    if (role === 'assistant' && hasToolCalls(msg)) {
      // A new assistant turn with tool_calls begins. If a previous one
      // was buffered, its tools are now orphaned.
      flushBufferedAssistant();
      bufferedAssistant = msg;
      pendingToolIds = collectToolCallIds(msg);
      continue;
    }
    if (role === 'tool') {
      const id = msg.toolCallId;
      if (pendingToolIds.has(id)) {
        // Tool result closes part of the pending turn — emit the
        // buffered assistant (if any) and the tool message.
        flushBufferedAssistant();
        result.push(msg);
        pendingToolIds.delete(id);
        if (pendingToolIds.size === 0) {
          // All tools answered; deferred user messages are safe to emit.
          flushDeferredUsers();
        }
      } else {
        // Orphan tool — the assistant's tool_call was never recorded or
        // was already answered. Drop it; the provider would reject.
        orphanToolMessages++;
      }
      continue;
    }
    if (role === 'user' && pendingToolIds.size > 0) {
      // User message arrived while tools were still in flight. Defer
      // it until the last tool result so the adjacency holds.
      deferredUsers.push(msg);
      deferredUserMessages++;
      continue;
    }
    // Any other message (system, plain assistant, user between runs)
    // closes the current turn. Flush buffered assistant (which may be
    // orphan) and any deferred users, then emit the message itself.
    flushBufferedAssistant();
    flushDeferredUsers();
    result.push(msg);
  }

  // Trailing state: the last assistant may have unanswered tools; the
  // last user messages may still be deferred.
  flushBufferedAssistant();
  flushDeferredUsers();

  return {
    messages: result,
    diagnostics: {
      orphanToolMessages,
      strippedToolCalls,
      deferredUserMessages,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasToolCalls(
  msg: Message,
): msg is Message & {
  role: 'assistant';
  toolCalls: readonly { id: string }[];
} {
  return (
    msg.role === 'assistant' &&
    Array.isArray((msg as { toolCalls?: unknown }).toolCalls) &&
    (msg as { toolCalls: readonly { id: string }[] }).toolCalls.length > 0
  );
}

function collectToolCallIds(msg: Message): Set<string> {
  if (!hasToolCalls(msg)) return new Set();
  return new Set(
    msg.toolCalls
      .map((tc) => tc.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
}

/**
 * Return a copy of the assistant message with `toolCalls` removed. Used
 * when an assistant emitted tool_calls but never received a result, so
 * the provider does not see a dangling tool_call. `reasoningContent`
 * and other fields are preserved.
 */
function stripToolCalls(msg: Message): Message {
  if (msg.role !== 'assistant') return msg;
  const assistant = msg as Message & { role: 'assistant' };
  // exactOptionalPropertyTypes: build a new object without the key
  // rather than assigning undefined.
  return {
    role: 'assistant',
    content: assistant.content,
    ...(assistant.reasoningContent !== undefined
      ? { reasoningContent: assistant.reasoningContent }
      : {}),
  };
}
