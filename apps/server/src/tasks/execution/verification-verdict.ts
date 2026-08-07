/**
 * Pure helpers for interpreting a verifier session's raw response and
 * building the retry message an executor subtask sees afterward.
 * Split out from task-execution.ts so the JSON-extraction and reason-
 * selection logic can be unit tested directly, without driving
 * TaskExecution's private handleVerificationResult through a full run
 * event.
 */

const RETRY_EXECUTE_DIRECTIVE =
  'Do not ask what to do — execute the task directly.';

export type VerificationVerdict = {
  isComplete: boolean;
  /** Best-effort reason text to show the executor on retry, always present. */
  reason: string;
  /** The verifier's raw `verdict` field, when structured output parsed cleanly. */
  rawVerdict?: string;
};

/**
 * Extracts the first balanced `{...}` object from `text`, tracking string
 * literals so a brace inside a quoted value (code, regex, JSON example in
 * the verifier's `reason`) can't end the match early. Returns null if no
 * balanced object is found.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Interprets a verifier's raw response text: whether the subtask is
 * COMPLETED, and — when it isn't — the best available reason to hand back
 * to the executor. Prefers the verifier's structured `reason` field; falls
 * back to the raw response text when JSON parsing fails, no balanced object
 * is found, or `reason` is missing/non-string (an LLM can legitimately emit
 * `reason` as an array, a number, or omit it — this must never throw).
 */
export function parseVerificationVerdict(content: string): VerificationVerdict {
  const jsonText = extractJsonObject(content);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as {
        verdict?: unknown;
        reason?: unknown;
      };
      const isComplete =
        typeof parsed.verdict === 'string' &&
        parsed.verdict.toUpperCase() === 'COMPLETED';
      const reason =
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : content.trim();
      return typeof parsed.verdict === 'string'
        ? { isComplete, reason, rawVerdict: parsed.verdict }
        : { isComplete, reason };
    } catch {
      // Not valid JSON despite the balanced braces — fall through to the
      // plain-text heuristic below.
    }
  }
  const isComplete =
    /\bCOMPLETED\b/i.test(content) && !/\bINCOMPLETE\b/i.test(content);
  return { isComplete, reason: content.trim() };
}

/**
 * Builds the message sent back to a subtask's session on retry. When
 * `reason` is given (a verification verdict), the agent is told exactly
 * what was wrong, truncated to `maxChars` with an explicit marker so it
 * never mistakes a cut mid-sentence for the complete verdict. Without a
 * reason (the stuck-subtask sweep, which isn't verification-driven), the
 * message stays generic.
 */
export function buildRetryMessage(
  reason: string | undefined,
  maxChars: number,
): string {
  if (!reason) {
    return `Please continue and complete this subtask. Focus on delivering the actual output requested. ${RETRY_EXECUTE_DIRECTIVE}`;
  }
  const wasTruncated = reason.length > maxChars;
  const reasonText = wasTruncated
    ? `${reason.slice(0, maxChars)}\n\n[…reason truncated at ${maxChars} chars…]`
    : reason;
  return `Your previous attempt at this subtask was reviewed and marked incomplete. Here is specifically what was wrong or missing:\n\n${reasonText}\n\nAddress this directly, then deliver the actual output requested. ${RETRY_EXECUTE_DIRECTIVE}`;
}
