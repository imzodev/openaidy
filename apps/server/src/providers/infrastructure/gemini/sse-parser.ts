/**
 * Server-Sent Events (SSE) parser
 *
 * A small, dependency-free stateful SSE parser that pulls complete
 * `SseEvent`s out of a stream of decoded text chunks. Designed to
 * run inside the `gemini` adapter's streaming loop, where bytes
 * arrive in arbitrary chunk sizes and we have to handle the case
 * where a chunk boundary lands mid-line or mid-event.
 *
 * Why a dedicated parser: the previous inline implementation only
 * handled `data: ` lines (with the trailing space) and a single
 * SSE line at a time. Gemini has been seen to send:
 *   - `data:` lines without the trailing space (less common but
 *     spec-allowed);
 *   - `event:`, `id:`, and `retry:` fields that the previous
 *     implementation silently dropped, which is fine for Gemini
 *     today but would be a footgun if the server started sending
 *     them;
 *   - multi-line data fields (rare, but valid);
 *   - a trailing line that doesn't end with `\n` on connection
 *     close, which the old code would `JSON.parse` and then
 *     complain "Unexpected non-whitespace character after JSON" if
 *     the next chunk happened to start mid-line;
 *   - CRLF line endings, which `split('\n')` alone leaves a
 *     trailing `\r` on each line.
 *
 * The parser keeps the buffer across calls and emits events as
 * soon as a blank line is seen (per the SSE spec). Lines that
 * start with `:` are comments and ignored, as are `event:`/`id:`/
 * `retry:` lines (their values are captured in `SseEvent` only if
 * useful — for Gemini we only care about `data`).
 */

import type { SseEvent, SseParserState } from './sse-parser.types';

/**
 * Append a chunk of decoded text to the parser state and return
 * any complete events that fit. The `state.buffer` is updated
 * in place; the caller is expected to keep using the same `state`
 * object across `read()` calls.
 *
 * @param state   Mutable parser state owned by the caller.
 * @param chunk   A newly-decoded text chunk from the stream.
 * @returns       An array of complete events; possibly empty if
 *                the chunk ended mid-line.
 */
export function takeSseEvents(
  state: SseParserState,
  chunk: string,
): SseEvent[] {
  if (chunk.length === 0) return [];

  state.buffer += chunk;
  // Normalize CRLF and bare CR to LF. The SSE spec allows CRLF
  // and bare CR as line terminators in addition to LF; the
  // browser-standard TextDecoder emits the wire bytes as-is, so a
  // server using CRLF produces "\r\n" in the decoded text.
  if (state.buffer.includes('\r')) {
    state.buffer = state.buffer.replace(/\r\n?/g, '\n');
  }

  // An SSE event is terminated by a blank line (i.e. `\n\n`).
  // We split the buffer on `\n\n` to extract all *complete* events,
  // then split each event on `\n` to get individual lines. Anything
  // after the last `\n\n` is the in-progress event (or the
  // trailing incomplete line of the previous event) — we keep
  // that in the buffer for the next chunk.
  const text = state.buffer;
  const events: SseEvent[] = [];

  // Walk through `\n\n` boundaries.
  let cursor = 0;
  while (true) {
    const boundary = text.indexOf('\n\n', cursor);
    if (boundary === -1) break;

    const eventText = text.slice(cursor, boundary);
    const dataLines: string[] = [];

    for (const rawLine of eventText.split('\n')) {
      if (rawLine === '' || rawLine.startsWith(':')) continue;
      const colonIdx = rawLine.indexOf(':');
      if (colonIdx === -1) continue;
      const field = rawLine.slice(0, colonIdx);
      // The spec says: "If the value is not empty, and the first
      // character of the value is a U+0020 SPACE character, the
      // value is parsed as the substring of the value starting
      // from the character immediately after the U+0020 SPACE
      // character."
      const value =
        colonIdx + 1 < rawLine.length && rawLine[colonIdx + 1] === ' '
          ? rawLine.slice(colonIdx + 2)
          : rawLine.slice(colonIdx + 1);
      if (field === 'data') dataLines.push(value);
      // `event`, `id`, `retry` are not used by the Gemini API;
      // captured here for spec completeness. Extend `SseEvent` to
      // surface them if a future response needs to.
    }

    if (dataLines.length > 0) {
      events.push({ data: dataLines.join('\n') });
    }

    cursor = boundary + 2;
  }

  // Whatever follows the last complete event boundary is
  // in-progress and must be kept for the next chunk. This
  // includes both the trailing partial line of a complete event
  // and a fully-incomplete event with no `\n\n` yet.
  state.buffer = text.slice(cursor);

  return events;
}
