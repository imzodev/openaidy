import type { ToolDefinition } from '@openaidy/runtime';
import type { CompactionSourceMessage } from '@openaidy/shared-types';

export const TOOL_SEARCH_NAME = 'tool_search';

/**
 * Above this many MCP tools, their schemas are not sent up front; the model
 * sees a name index and loads what it needs with tool_search. Every schema
 * costs context on every round, and long tool lists also make models pick
 * worse.
 */
export const DEFER_MCP_TOOLS_ABOVE = 25;

const DEFAULT_MAX_RESULTS = 5;

export const TOOL_SEARCH_DEFINITION: ToolDefinition = {
  name: TOOL_SEARCH_NAME,
  description:
    'Load the full definitions of tools listed in [DEFERRED_TOOLS] so you can call them. ' +
    'Pass "select:<name>,<name>" to load exact tools, or keywords to search names and descriptions. ' +
    'Loaded tools become callable from your next turn on.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Either "select:server::tool,server::other" or a few keywords (e.g. "github pull request").',
      },
      max_results: {
        type: 'number',
        description: `Maximum tools to return for a keyword search (default ${DEFAULT_MAX_RESULTS}).`,
      },
    },
    required: ['query'],
  },
};

/** Tools matching a tool_search query, best match first. */
export function searchTools(
  tools: readonly ToolDefinition[],
  query: string,
  maxResults = DEFAULT_MAX_RESULTS,
): ToolDefinition[] {
  const trimmed = query.trim();
  if (trimmed.toLowerCase().startsWith('select:')) {
    const names = new Set(
      trimmed
        .slice('select:'.length)
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    );
    return tools.filter((t) => names.has(t.name));
  }

  const terms = trimmed
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (terms.length === 0) return [];
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      const score = terms.reduce(
        (sum, term) =>
          sum +
          (name.includes(term) ? 3 : 0) +
          (description.includes(term) ? 1 : 0),
        0,
      );
      return { tool, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxResults))
    .map((r) => r.tool);
}

/** What a tool_search call returns to the model. */
export function formatToolSearchResult(
  found: readonly ToolDefinition[],
): string {
  if (found.length === 0) {
    return 'No matching tools. Check the names in [DEFERRED_TOOLS] or try other keywords.';
  }
  return JSON.stringify({
    loaded: found.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  });
}

/**
 * Deferred tools already loaded in this session: ones the model has called,
 * and ones returned by an earlier tool_search. Derived from the transcript,
 * so nothing extra has to be stored.
 */
export function loadedToolNamesFromHistory(
  messages: readonly CompactionSourceMessage[],
): Set<string> {
  const names = new Set<string>();
  for (const m of messages) {
    const calls = m.metadata?.['toolCalls'];
    if (Array.isArray(calls)) {
      for (const call of calls) {
        const name = (call as { name?: unknown }).name;
        if (typeof name === 'string') names.add(name);
      }
    }
    if (m.role === 'tool' && m.metadata?.['toolName'] === TOOL_SEARCH_NAME) {
      try {
        const parsed = JSON.parse(m.content) as {
          loaded?: Array<{ name?: unknown }>;
        };
        for (const t of parsed.loaded ?? []) {
          if (typeof t.name === 'string') names.add(t.name);
        }
      } catch (_err) {
        // A "no matching tools" result is plain text, not JSON.
      }
    }
  }
  return names;
}

/** Prompt block naming the tools that can be loaded with tool_search. */
export function buildDeferredToolsBlock(
  deferred: readonly ToolDefinition[],
): string {
  const lines = deferred.map((t) => {
    const firstSentence = t.description.split(/(?<=[.!?])\s/)[0] ?? '';
    const summary =
      firstSentence.length > 120
        ? `${firstSentence.slice(0, 117)}...`
        : firstSentence;
    return `- ${t.name}${summary ? `: ${summary}` : ''}`;
  });
  return `\n\n[DEFERRED_TOOLS]\nThese tools are available but their definitions are not loaded yet. Before calling one, load it with tool_search (e.g. tool_search({ query: "select:${deferred[0]?.name ?? 'server::tool'}" })). Load only what the current task needs.\n${lines.join('\n')}\n[/DEFERRED_TOOLS]`;
}
