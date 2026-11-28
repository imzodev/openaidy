import {
  REASONING_EFFORT_VALUES,
  type ReasoningEffort,
} from '@aidyagent/shared-types';

const KEY_PREFIX = 'aidy.reasoningEffort.';

/**
 * The thinking effort chosen for a conversation, remembered in this browser.
 * Undefined = Auto (the agent's default). Storage errors (private mode,
 * quota) read as Auto rather than breaking the chat.
 */
export function getSessionReasoningEffort(
  sessionId: string | undefined,
): ReasoningEffort | undefined {
  if (!sessionId) return undefined;
  try {
    const stored = localStorage.getItem(KEY_PREFIX + sessionId);
    return REASONING_EFFORT_VALUES.includes(stored as ReasoningEffort)
      ? (stored as ReasoningEffort)
      : undefined;
  } catch (_err) {
    return undefined;
  }
}

/** Remember (or, with undefined, forget) a conversation's thinking effort. */
export function setSessionReasoningEffort(
  sessionId: string,
  effort: ReasoningEffort | undefined,
): void {
  try {
    if (effort) localStorage.setItem(KEY_PREFIX + sessionId, effort);
    else localStorage.removeItem(KEY_PREFIX + sessionId);
  } catch (_err) {
    // Not persisted; the choice still applies until the page reloads.
  }
}
