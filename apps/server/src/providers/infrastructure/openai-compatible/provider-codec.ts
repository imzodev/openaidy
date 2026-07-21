/**
 * Provider-specific adapter behaviour.
 *
 * The OpenAI-compatible adapter speaks to several different
 * providers (OpenAI, Groq, DeepSeek, OpenRouter, etc.) that
 * mostly look the same on the wire but have small, important
 * differences:
 *
 *   - DeepSeek restricts function-call tool names to
 *     `^[a-zA-Z0-9_-]+$`, so MCP-style names with `::` or
 *     dotted names must be translated on the request side and
 *     the original recovered on the response side. Without a
 *     per-call name map, naive sanitization mangles legitimate
 *     native tool names like `workspace_list` into
 *     `workspace.list`.
 *   - DeepSeek streams `reasoning_content` deltas alongside
 *     regular content for its thinking-mode models.
 *
 * These quirks are scattered across the adapter (request
 * shaping, response shaping, streaming event handling), so we
 * centralise them here behind a `ProviderAdapterCodec`
 * interface. Adding a new OpenAI-compatible provider with
 * quirks is a single subclass — not a chain of
 * `if (baseUrl.includes('foo'))` branches in the adapter.
 *
 * The codec is selected once at adapter construction
 * (`selectAdapterCodec`) and consulted at every request.
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
   * non-streaming response message. Returns `null` if the
   * codec has no reasoning-mode support.
   */
  extractReasoningField(message: unknown): string | null;

  /**
   * Optional: pick the `reasoningContent` field off an
   * assistant message (the in-memory shape), for the request
   * side. Returns `undefined` for codecs that have no
   * reasoning-mode round-trip.
   */
  pickRequestReasoningContent(message: unknown): string | undefined;
}

/**
 * Default codec — passes tool names through unchanged, no
 * reasoning-mode support. Used by OpenAI, Groq, OpenRouter,
 * and any other provider that doesn't have quirks beyond the
 * standard OpenAI Chat Completions shape.
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
}

/**
 * DeepSeek-specific codec:
 *   - Sanitises tool names to `^[a-zA-Z0-9_-]+$` on the
 *     request side and recovers the original via a per-call
 *     name map on the response side.
 *   - Surfaces the `reasoning_content` deltas (streaming)
 *     and field (non-streaming) returned by DeepSeek's
 *     thinking-mode models.
 */
export class DeepSeekAdapterCodec implements ProviderAdapterCodec {
  readonly name = 'deepseek';

  prepareRequest(tools: readonly ToolDefinition[]): {
    wire: Array<{ name: string; description: string; parameters: unknown }>;
    nameMap: ToolNameMapping;
  } {
    const nameMap = new Map<string, string>();
    const wire = tools.map((tool) => {
      const wireName = sanitize(tool.name);
      if (wireName !== tool.name) {
        nameMap.set(wireName, tool.name);
      }
      return {
        name: wireName,
        description: tool.description,
        parameters: tool.parameters,
      };
    });
    return { wire, nameMap };
  }

  restoreName(wireName: string, nameMap: ToolNameMapping): string {
    return nameMap.get(wireName) ?? wireName;
  }

  extractReasoningDelta(chunk: unknown): string | null {
    const choice = (chunk as { choices?: Array<{ delta?: unknown }> })
      ?.choices?.[0];
    if (!choice) return null;
    const delta = (choice as { delta?: { reasoning_content?: unknown } }).delta;
    return typeof delta?.reasoning_content === 'string'
      ? delta.reasoning_content
      : null;
  }

  extractReasoningField(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const field = (message as { reasoning_content?: unknown })
      .reasoning_content;
    return typeof field === 'string' ? field : null;
  }

  pickRequestReasoningContent(message: unknown): string | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const field = (message as { reasoningContent?: unknown }).reasoningContent;
    return typeof field === 'string' ? field : undefined;
  }
}

/**
 * The DeepSeek character allow-list. A tool name is wire-safe
 * iff every character is in this set; otherwise the characters
 * are replaced with `_` on the way out and recovered via the
 * per-call name map on the way back.
 */
const DEEPSEEK_ALLOWED = /^[a-zA-Z0-9_-]+$/;

/**
 * Replace any character outside the DeepSeek allow-list with
 * `_`. Returns the input unchanged if it was already wire-safe.
 */
function sanitize(name: string): string {
  return DEEPSEEK_ALLOWED.test(name)
    ? name
    : name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Shared empty map for the identity codec. Avoids allocating
 * a fresh Map per request.
 */
const EMPTY_NAME_MAP: ToolNameMapping = new Map();
