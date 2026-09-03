/**
 * MiniMax-specific codec.
 *
 * Most of the MiniMax wire shape matches OpenAI Chat
 * Completions, but the M-series models occasionally emit
 * internal framing tokens (`]<]<model_id>[>[`) and tool-block
 * wrappers inside `choice.delta.content`. The standard OpenAI
 * SDK does not strip them, so without this codec the client
 * sees the raw markup and the response is cut off (the model
 * has already finished its turn with `finish_reason:
 * tool_calls`).
 *
 * The codec delegates every other concern (name mapping,
 * reasoning content) to the identity codec. New MiniMax-only
 * quirks should be added here, not in `IdentityAdapterCodec`.
 *
 * The sanitization is stateless and per-chunk: it cannot
 * reconstruct a tool call whose wrapping was split across
 * multiple deltas. That would require a stateful parser and a
 * separate rework of the streaming loop ΓÇö out of scope here.
 */

import type { ToolDefinition } from '@openaidy/runtime';
import type {
  ProviderAdapterCodec,
  ToolNameMapping,
} from '../provider-codec.js';
import { EMPTY_NAME_MAP } from '../provider-codec.js';

export class MiniMaxAdapterCodec implements ProviderAdapterCodec {
  readonly name = 'minimax';

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
    if (!delta) return delta;

    let cleaned = delta;

    // 1. Strip full tool-block wrappers (inner content dropped).
    for (const pattern of MINIMAX_TOOL_BLOCK_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 2. Strip orphan openers and the rest of the chunk after
    //    them. The lookahead fired because the closer is missing
    //    from this chunk ΓÇö assume the rest of the payload is the
    //    first fragment of a leaked tool invocation.
    for (const pattern of MINIMAX_TOOL_BLOCK_OPENERS) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 3. Strip the standalone framing-token boundaries. Run
    //    after the block patterns so a `\]\<\][minimax\[\>\[`
    //    that immediately precedes a tool block does not leave
    //    a dangling token behind.
    cleaned = cleaned.replace(MINIMAX_FRAMING_TOKEN_RE, '');

    // 4. Final safety net: scan for any remaining tool-call-like
    //    tag. If found, drop from the first match to end of chunk.
    //    Catches formats the regexes above don't enumerate (new
    //    model variants, zero-width-space bypasses, etc.). False
    //    positives are unlikely because these codecs only run on
    //    assistant content (never on user-supplied text).
    const toolTag = cleaned.match(MINIMAX_GENERIC_TOOL_TAG_RE);
    if (toolTag && toolTag.index !== undefined) {
      cleaned = cleaned.slice(0, toolTag.index);
    }

    return cleaned;
  }
}

// =====================
// MiniMax Streaming Sanitization
// =====================

/**
 * MiniMax M-series models wrap their internal tool-call stream
 * in markers that look like `]<]<model_id>[>[`. When the SDK
 * upstream surfaces them inside `choice.delta.content` instead
 * of (or in addition to) `choice.delta.tool_calls`, the raw
 * markup reaches the client as visible text. This regex strips
 * those token boundaries unconditionally; they are control
 * markers that never appear in legitimate user-visible text.
 */
// The literal `<` documents the leaked token shape
// `]<]<id>[>[` alongside the matching `\]` and `\[` siblings
// for grep-ability.
// eslint-disable-next-line no-useless-escape
const MINIMAX_FRAMING_TOKEN_RE = /\]\<\][^\s\]]+\[>\[/g;

/**
 * Tool-call wrapper blocks that can leak into a content delta.
 * Each pattern is paired with its closing counterpart. The inner
 * content is dropped because it is a tool payload that should
 * have been routed through `stream.tool_call` ΓÇö surfacing it as
 * text is the leak we are preventing.
 */
const MINIMAX_TOOL_BLOCK_PATTERNS: readonly RegExp[] = [
  /<tool_call>[\s\S]*?<\/tool_call>/g,
  /<function_calls>[\s\S]*?<\/function_calls>/g,
  /<tools>[\s\S]*?<\/tools>/g,
  /\[TOOL_CALLS\][\s\S]*?\[\/TOOL_CALLS\]/g,
  /\[{tool_[a-zA-Z0-9_-]+\}[\s\S]*?\{\/tool_[a-zA-Z0-9_-]+\}\]/g,
  /<invoke\b[^>]*>[\s\S]*?<\/invoke>/g,
];

/**
 * Orphan tool-block openers. When a chunk contains an opener
 * but no matching close, the rest of the chunk is almost
 * certainly the first fragment of a leaked tool invocation ΓÇö
 * drop the opener AND everything after it. The matching close
 * sits in the next chunk (or was truncated by the model). Either
 * way, the partial payload cannot be safely reconstituted as a
 * `stream.tool_call` from inside a stateless per-chunk
 * sanitizer, so the safe move is to discard.
 */
const MINIMAX_TOOL_BLOCK_OPENERS: readonly RegExp[] = [
  /<tool_call>(?![\s\S]*?<\/tool_call>)[\s\S]*/g,
  /<function_calls>(?![\s\S]*?<\/function_calls>)[\s\S]*/g,
  /<tools>(?![\s\S]*?<\/tools>)[\s\S]*/g,
  /\[TOOL_CALLS\](?![\s\S]*?\[\/TOOL_CALLS\])[\s\S]*/g,
  /\[{tool_[a-zA-Z0-9_-]+\}(?![\s\S]*?\{\/tool_[a-zA-Z0-9_-]+\})[\s\S]*/g,
  /<invoke\b[^>]*>(?![\s\S]*?<\/invoke>)[\s\S]*/g,
];

/**
 * Final-pass safety net. After every known wrapper pattern has
 * been stripped, scan for any remaining tool-call-looking tag.
 * Real session evidence: run `FhvhPZ5j3SpiKYvaNzrsT` — the model
 * emitted `<invoke name="exec_run">…</invoke>` without any
 * `<tool_call>` wrapper and the existing pattern set missed it.
 * Also catches zero-width-space bypasses and future model
 * variants we haven't enumerated. False positives are unlikely
 * because these codecs only run on assistant content (never on
 * user-supplied text).
 */
export const MINIMAX_GENERIC_TOOL_TAG_RE =
  /<(invoke|tool_call|function_calls?|antml:[a-z]+)\b/i;
