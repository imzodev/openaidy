/**
 * Native tool result types
 *
 * These are server-internal types used by builtin (native) tools to return
 * structured results back to the agentic loop.
 *
 * The `INTERRUPT_CHOICES` variant signals to the agentic loop that execution
 * should pause and emit a choices event to the client instead of continuing.
 */

/**
 * Discriminated union of possible native tool result types.
 *
 * Variants:
 * - SUCCESS: tool completed normally with output text
 * - ERROR: tool encountered an error with error message
 * - INTERRUPT_CHOICES: tool requests the agentic loop pause and present
 *   choice options to the user (carries question + choices array)
 */
export type NativeToolResult =
  | { type: 'SUCCESS'; output: string }
  | { type: 'ERROR'; message: string }
  | { type: 'INTERRUPT_CHOICES'; question?: string; choices: string[] };
