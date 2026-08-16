/**
 * Utilities for processing LLM message content.
 *
 * Different models output reasoning/thinking in different formats.
 * This module provides helpers to strip or extract those sections so that
 * downstream logic (e.g. verdict parsing) only sees the final answer.
 *
 * Supported formats:
 *   - <think>...</think>  — DeepSeek, Qwen, MiniMax and others
 */

/**
 * Strip all thinking/reasoning blocks from an LLM response and return only
 * the visible answer text.
 *
 * Models that emit extended reasoning wrap their internal monologue in
 * `<think>...</think>` tags before the final answer. This function removes
 * those blocks so callers can reliably parse the actual response.
 *
 * A response truncated mid-reasoning (e.g. by a max-tokens cutoff) never
 * emits a closing `</think>`, so an unterminated `<think>` is also stripped
 * through to the end of the string rather than left to leak into the reply.
 *
 * @example
 * stripThinking('<think>let me reason...</think>\nCOMPLETED')
 * // => 'COMPLETED'
 */
export function stripThinking(content: string): string {
  if (!/<think>/i.test(content)) return content;
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

/**
 * Extract only the thinking/reasoning text from an LLM response, concatenated.
 * Returns an empty string if no thinking blocks are found.
 */
export function extractThinking(content: string): string {
  const matches = [...content.matchAll(/<think>([\s\S]*?)<\/think>/gi)];
  return matches
    .map((m) => m[1]?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
}
