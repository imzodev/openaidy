/**
 * DeepSeek-specific codec.
 *
 * The OpenAI-compatible adapter speaks to several different
 * providers that mostly look the same on the wire but have
 * small, important differences. DeepSeek has two:
 *
 *   - It restricts function-call tool names to
 *     `^[a-zA-Z0-9_-]+$`, so MCP-style names with `::` or
 *     dotted names must be translated on the request side and
 *     the original recovered on the response side. Without a
 *     per-call name map, naive sanitization mangles legitimate
 *     native tool names like `workspace_list` into
 *     `workspace.list`.
 *   - It streams `reasoning_content` deltas alongside regular
 *     content for its thinking-mode models.
 *
 * These quirks are isolated here so the OpenAI-compatible
 * adapter can stay provider-agnostic. The codec is selected
 * once by `selectAdapterCodec` (in `../adapter.ts`) and
 * consulted at every request.
 */

import type { ToolDefinition } from '@openaidy/runtime';
import type {
  ProviderAdapterCodec,
  ToolNameMapping,
} from '../provider-codec.js';

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

  sanitizeContentDelta(delta: string): string {
    return delta;
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
