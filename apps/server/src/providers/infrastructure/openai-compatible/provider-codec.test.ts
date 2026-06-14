/**
 * Tests for the OpenAI-compatible adapter codec strategy.
 *
 * The DeepSeek codec is the most behaviour-heavy one: it
 * sanitises tool names to `^[a-zA-Z0-9_-]+$` and recovers
 * the original via a per-call name map. The exact behaviour
 * matters because the previous naive
 * `_` -> `.` restore mangled legitimate native tool names
 * like `workspace_list` into `workspace.list`, which then
 * fell through the dispatcher's builtin lookup and was sent
 * to the MCP layer as a non-existent server.
 */

import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '@openaidy/runtime';
import { IdentityAdapterCodec, DeepSeekAdapterCodec } from './provider-codec';

const tool = (name: string): ToolDefinition => ({
  name,
  description: `desc for ${name}`,
  parameters: { type: 'object', properties: {} },
});

describe('IdentityAdapterCodec', () => {
  const codec = new IdentityAdapterCodec();

  it('passes tool names through unchanged on the request side', () => {
    const { wire, nameMap } = codec.prepareRequest([
      tool('workspace_list'),
      tool('github::create_or_update_file'),
    ]);
    expect(wire.map((t) => t.name)).toEqual([
      'workspace_list',
      'github::create_or_update_file',
    ]);
    expect(nameMap.size).toBe(0);
  });

  it('restores the wire name unchanged (no map lookup)', () => {
    const { nameMap } = codec.prepareRequest([tool('workspace_list')]);
    expect(codec.restoreName('workspace_list', nameMap)).toBe('workspace_list');
    expect(codec.restoreName('anything', nameMap)).toBe('anything');
  });

  it('returns null for reasoning-mode extractions', () => {
    expect(
      codec.extractReasoningDelta({ choices: [{ delta: { content: 'hi' } }] }),
    ).toBeNull();
    expect(
      codec.extractReasoningField({
        content: 'hi',
        reasoning_content: 'thinking',
      }),
    ).toBeNull();
    expect(
      codec.pickRequestReasoningContent({ reasoningContent: 'thinking' }),
    ).toBeUndefined();
  });
});

describe('DeepSeekAdapterCodec', () => {
  const codec = new DeepSeekAdapterCodec();

  describe('prepareRequest', () => {
    it('passes through names that are already wire-safe', () => {
      const { wire, nameMap } = codec.prepareRequest([
        tool('workspace_list'),
        tool('present_choices'),
      ]);
      expect(wire.map((t) => t.name)).toEqual([
        'workspace_list',
        'present_choices',
      ]);
      // No map entries needed for names that round-trip unchanged.
      expect(nameMap.size).toBe(0);
    });

    it('replaces every non-allowed character with `_`', () => {
      // `::` is two disallowed characters, so it becomes
      // `__` (two underscores) on the wire. The per-call
      // name map round-trips the original `::` form.
      const { wire } = codec.prepareRequest([
        tool('github::create_or_update_file'),
      ]);
      expect(wire[0]?.name).toBe('github__create_or_update_file');
    });

    it('handles a name that uses dots', () => {
      const { wire, nameMap } = codec.prepareRequest([tool('workspace.list')]);
      expect(wire[0]?.name).toBe('workspace_list');
      expect(nameMap.get('workspace_list')).toBe('workspace.list');
    });

    it('handles a name that uses spaces and parens', () => {
      const { wire, nameMap } = codec.prepareRequest([tool('tool (v2)')]);
      expect(wire[0]?.name).toBe('tool__v2_');
      expect(nameMap.get('tool__v2_')).toBe('tool (v2)');
    });
  });

  describe('restoreName', () => {
    it('recovers a name that needed sanitization', () => {
      const { nameMap } = codec.prepareRequest([
        tool('github::create_or_update_file'),
      ]);
      expect(codec.restoreName('github__create_or_update_file', nameMap)).toBe(
        'github::create_or_update_file',
      );
    });

    it('recovers a name that used a dot', () => {
      const { nameMap } = codec.prepareRequest([tool('workspace.list')]);
      expect(codec.restoreName('workspace_list', nameMap)).toBe(
        'workspace.list',
      );
    });

    it('returns the wire name unchanged for names that did not need sanitization', () => {
      // Native tool `workspace_list` is wire-safe as-is. No map
      // entry is created at request time, but the restore call
      // falls back to the wire name (which happens to equal
      // the original). This is the property that fixed the
      // "MCP server workspace.list not connected" bug: native
      // tool names with `_` no longer get mangled to `.`.
      const { nameMap } = codec.prepareRequest([tool('workspace_list')]);
      expect(nameMap.size).toBe(0);
      expect(codec.restoreName('workspace_list', nameMap)).toBe(
        'workspace_list',
      );
    });

    it('falls back to the input for unknown names the model invented', () => {
      expect(codec.restoreName('mystery_tool', new Map())).toBe('mystery_tool');
    });
  });

  describe('reasoning content', () => {
    it('extracts reasoning_content from a streaming delta', () => {
      const delta = codec.extractReasoningDelta({
        choices: [{ delta: { reasoning_content: 'thinking...', content: '' } }],
      });
      expect(delta).toBe('thinking...');
    });

    it('returns null when the streaming delta has no reasoning_content', () => {
      const delta = codec.extractReasoningDelta({
        choices: [{ delta: { content: 'hi' } }],
      });
      expect(delta).toBeNull();
    });

    it('extracts reasoning_content from a non-streaming response message', () => {
      const field = codec.extractReasoningField({
        role: 'assistant',
        content: 'final',
        reasoning_content: 'deep thought',
      });
      expect(field).toBe('deep thought');
    });

    it('returns null for non-string reasoning_content (defensive)', () => {
      expect(codec.extractReasoningField({ reasoning_content: 42 })).toBeNull();
      expect(codec.extractReasoningField(null)).toBeNull();
    });

    it('picks reasoningContent off an in-memory assistant message for the request side', () => {
      const reasoning = codec.pickRequestReasoningContent({
        role: 'assistant',
        content: 'final',
        reasoningContent: 'thoughts',
      });
      expect(reasoning).toBe('thoughts');
    });

    it('returns undefined when reasoningContent is missing', () => {
      expect(
        codec.pickRequestReasoningContent({ role: 'assistant', content: 'hi' }),
      ).toBeUndefined();
    });
  });

  describe('regression — workspace_list dispatch', () => {
    // The bug the user reported:
    //   Error: MCP server workspace.list not connected
    //
    // Cause: the previous `restoreToolName` did a global
    // `_` -> `.` substitution, which mangled the native
    // `workspace_list` into `workspace.list` on the response
    // side. The dispatcher then looked up `workspace.list`
    // in the builtin registry, didn't find it, and fell
    // through to the MCP layer with `workspace.list` as
    // the server name. The fix is the per-call name map:
    // `workspace_list` is wire-safe, so no map entry is
    // created, and the restore call returns the wire name
    // unchanged.
    it('preserves `workspace_list` through a full round-trip', () => {
      const { wire, nameMap } = codec.prepareRequest([tool('workspace_list')]);
      expect(wire[0]?.name).toBe('workspace_list');
      // The model echoes the wire name back; the dispatcher
      // needs to see `workspace_list`, NOT `workspace.list`.
      expect(codec.restoreName('workspace_list', nameMap)).toBe(
        'workspace_list',
      );
    });

    it('recovers `workspace.list` (dotted native name) through a full round-trip', () => {
      const { wire, nameMap } = codec.prepareRequest([tool('workspace.list')]);
      expect(wire[0]?.name).toBe('workspace_list');
      expect(codec.restoreName('workspace_list', nameMap)).toBe(
        'workspace.list',
      );
    });

    it('recovers an MCP-style `server::tool` name through a full round-trip', () => {
      const { wire, nameMap } = codec.prepareRequest([
        tool('github::create_or_update_file'),
      ]);
      expect(wire[0]?.name).toBe('github__create_or_update_file');
      expect(codec.restoreName('github__create_or_update_file', nameMap)).toBe(
        'github::create_or_update_file',
      );
    });
  });
});
