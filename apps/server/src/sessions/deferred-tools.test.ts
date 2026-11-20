import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '@openaidy/runtime';
import {
  buildDeferredToolsBlock,
  formatToolSearchResult,
  loadedToolNamesFromHistory,
  searchTools,
} from './deferred-tools';

const tool = (name: string, description: string): ToolDefinition => ({
  name,
  description,
  parameters: { type: 'object', properties: {} },
});

const TOOLS = [
  tool('github::create_pull_request', 'Create a pull request. Needs a head.'),
  tool('github::list_issues', 'List issues in a repository.'),
  tool('notion::search', 'Search Notion pages.'),
];

describe('searchTools', () => {
  it('selects exact names', () => {
    expect(
      searchTools(TOOLS, 'select:notion::search, github::list_issues').map(
        (t) => t.name,
      ),
    ).toEqual(['github::list_issues', 'notion::search']);
  });

  it('ranks keyword matches, names above descriptions', () => {
    const found = searchTools(TOOLS, 'github pull');
    expect(found[0]?.name).toBe('github::create_pull_request');
    expect(found.map((t) => t.name)).not.toContain('notion::search');
  });

  it('respects max results', () => {
    expect(searchTools(TOOLS, 'github', 1)).toHaveLength(1);
  });
});

describe('loadedToolNamesFromHistory', () => {
  it('collects called tools and tools returned by tool_search', () => {
    const names = loadedToolNamesFromHistory([
      {
        role: 'assistant',
        content: '',
        sequence: 1,
        metadata: { toolCalls: [{ name: 'github::list_issues' }] },
      },
      {
        role: 'tool',
        content: formatToolSearchResult([TOOLS[2] as ToolDefinition]),
        sequence: 2,
        metadata: { toolName: 'tool_search' },
      },
    ]);
    expect([...names].sort()).toEqual([
      'github::list_issues',
      'notion::search',
    ]);
  });
});

describe('buildDeferredToolsBlock', () => {
  it('lists each tool with the first sentence of its description', () => {
    const block = buildDeferredToolsBlock(TOOLS);
    expect(block).toContain(
      '- github::create_pull_request: Create a pull request.',
    );
    expect(block).not.toContain('Needs a head');
  });
});
