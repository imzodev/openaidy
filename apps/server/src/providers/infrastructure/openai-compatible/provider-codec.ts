/**
 * Provider-specific adapter behaviour.
 *
 * The OpenAI-compatible adapter speaks to several different
 * providers (OpenAI, Groq, DeepSeek, OpenRouter, MiniMax, etc.)
 * that mostly look the same on the wire but have small,
 * important differences. These quirks are scattered across the
 * adapter (request shaping, response shaping, streaming event
 * handling), so we centralise them here behind a
 * `ProviderAdapterCodec` interface.
 *
 * Adding a new OpenAI-compatible provider with quirks is a
 * single subclass — not a chain of `if (baseUrl.includes(...))`
 * branches in the adapter. Live codec implementations live in
 * `./provider-codec/{deepseek,minimax}.ts` and are re-exported
 * from this file so the public API stays flat.
 */

import type { ToolDefinition } from '@openaidy/runtime';

/**
 * Per-call mutable state produced by `prepareRequest` and
 * consumed by `restoreName`. Always a fresh map for a given
 * `invoke`/`invokeStream` call; safe to discard after the
 * call completes.
 */
export type ToolNameMapping = ReadonlyMap<string, string>;

/**
 * Per-call reasoning state (DeepSeek thinking mode).
 * Accumulator for `reasoning_content` deltas as the stream
 * progresses, exposed back to the caller as the
 * `reasoningContent` field on the model response.
 */
export type ReasoningAccumulator = {
  text: string;
};

/**
 * Provider-specific adapter behaviour. The methods are all
 * called from one place each; the adapter never branches on
 * provider identity directly.
 */
export interface ProviderAdapterCodec {
  /** Human-readable name for logging. */
  readonly name: string;

  /**
   * Build the wire-shaped tool list (the `tools` array sent
   * to the provider) and the per-call name map used to
   * restore the original name on the response side. The map
   * MUST be empty for codecs that pass tool names through
   * unchanged; codec implementations that sanitize are
   * responsible for keeping the map in sync with the wire
   * names they produce.
   */
  prepareRequest(tools: readonly ToolDefinition[]): {
    wire: Array<{
      name: string;
      description: string;
      parameters: unknown;
    }>;
    nameMap: ToolNameMapping;
  };

  /**
   * Look up a wire-side name in the per-call map. Falls back
   * to the input name when no mapping exists (e.g. a tool
   * name that didn't need sanitization in the first place,
   * or an unknown name the model invented).
   */
  restoreName(wireName: string, nameMap: ToolNameMapping): string;

  /**
   * Optional: extract a `reasoning_content` delta from a
   * streaming chunk. Returns `null` if the codec has no
   * reasoning-mode support.
   */
  extractReasoningDelta(chunk: unknown): string | null;

  /**
   * Optional: extract a `reasoning_content` field from a
   * non-streaming response message. Returns `null` for codecs
   * that have no reasoning-mode support.
   */
  extractReasoningField(message: unknown): string | null;

  /**
   * Optional: pick the `reasoningContent` field off an
   * assistant message (the in-memory shape), for the request
   * side. Returns `undefined` for codecs that have no
   * reasoning-mode round-trip.
   */
  pickRequestReasoningContent(message: unknown): string | undefined;

  /**
   * Strip leaked provider-side framing tokens from a streaming
   * content delta. Some OpenAI-compatible providers (notably
   * MiniMax M-series) occasionally emit tool-call wrappers and
   * their internal token boundaries inside the `content` field
   * of a streamed assistant delta. When that happens, the raw
   * markup reaches the client as user-visible text and (because
   * the model already finished its turn with `tool_calls`) the
   * response is cut off mid-stream.
   *
   * The default codec pass-through is safe: it returns the input
   * unchanged and assumes the upstream SDK already routed
   * tool calls to `choice.delta.tool_calls`. Codecs whose
   * upstream SDK does leak (or cannot be trusted to never leak)
   * override this to scrub the framing tokens before the delta
   * is yielded.
   *
   * The function is stateless and per-chunk: it cannot
   * reconstruct a tool call whose wrapping was split across
   * multiple deltas. That would require a stateful parser and a
   * separate rework of the streaming loop — out of scope here.
   */
  sanitizeContentDelta(delta: string): string;
}

/**
 * Default codec — passes tool names through unchanged, no
 * reasoning-mode support, no content sanitization. Used by
 * OpenAI, Groq, OpenRouter, and any other provider that
 * doesn't have quirks beyond the standard OpenAI Chat
 * Completions shape.
 */
export class IdentityAdapterCodec implements ProviderAdapterCodec {
  readonly name = 'identity';

  prepareRequest(tools: readonly ToolDefinition[]): {
    wire: Array<{ name: string; description: string; parameters: unknown }>;
    nameMap: ToolNameMapping;
  } {
    return {
      wire: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
      nameMap: EMPTY_NAME_MAP,
    };
  }

  restoreName(wireName: string, _nameMap: ToolNameMapping): string {
    return wireName;
  }

  extractReasoningDelta(_chunk: unknown): string | null {
    return null;
  }

  extractReasoningField(_message: unknown): string | null {
    return null;
  }

  pickRequestReasoningContent(_message: unknown): string | undefined {
    return undefined;
  }

  sanitizeContentDelta(delta: string): string {
    return delta;
  }
}

/**
 * Shared empty map for codecs that pass names through
 * unchanged. Avoids allocating a fresh Map per request.
 */
export const EMPTY_NAME_MAP: ToolNameMapping = new Map();

// Re-export provider-specific codecs so callers can keep
// importing everything from `./provider-codec.js` instead of
// reaching into the subdirectory. The subdirectory files own
// the implementation; this file owns the contract.
export { DeepSeekAdapterCodec } from './provider-codec/deepseek.js';
export { MiniMaxAdapterCodec } from './provider-codec/minimax.js';
