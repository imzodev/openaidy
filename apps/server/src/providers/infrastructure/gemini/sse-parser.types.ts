/**
 * Server-Sent Events (SSE) parser types
 *
 * Per project convention, types are exported from type files and
 * imported wherever needed.
 */

/**
 * One parsed SSE event, extracted from a stream of text chunks.
 * `data` is the concatenation of every `data:` line in the event,
 * joined by `\n` per the SSE spec.
 */
export type SseEvent = {
  readonly data: string;
};

/**
 * State of an in-flight SSE parser. Owned by the consumer across
 * multiple `ReadableStreamDefaultReader.read()` calls so partial
 * lines and partial events at chunk boundaries are handled.
 */
export type SseParserState = {
  /**
   * Incomplete trailing data (no terminating `\n` yet) carried over
   * from the previous chunk.
   */
  buffer: string;
};
