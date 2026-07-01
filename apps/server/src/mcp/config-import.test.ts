import { describe, it, expect } from 'vitest';
import {
  normalizeMcpServerEntry,
  normalizeMcpServerMap,
  McpConfigImportError,
} from './config-import';

describe('normalizeMcpServerEntry', () => {
  it('maps the Claude-Desktop http format (type -> transport, key -> id)', () => {
    const config = normalizeMcpServerEntry('github', {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    });
    expect(config).toEqual({
      id: 'github',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    });
  });

  it('accepts an explicit "transport" field too', () => {
    const config = normalizeMcpServerEntry('fs', {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    });
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('npx');
  });

  it('infers stdio from command when type/transport is omitted', () => {
    const config = normalizeMcpServerEntry('local', { command: 'my-server' });
    expect(config.transport).toBe('stdio');
  });

  it('infers http from url when type/transport is omitted', () => {
    const config = normalizeMcpServerEntry('remote', {
      url: 'https://example.com/mcp',
    });
    expect(config.transport).toBe('http');
  });

  it('accepts streamable-http as an http alias', () => {
    const config = normalizeMcpServerEntry('r', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    });
    expect(config.transport).toBe('http');
  });

  it('rejects sse with a helpful message', () => {
    expect(() =>
      normalizeMcpServerEntry('x', { type: 'sse', url: 'https://e.com' }),
    ).toThrow(/sse.*not supported/i);
  });

  it('rejects an unknown transport', () => {
    expect(() =>
      normalizeMcpServerEntry('x', { type: 'carrier-pigeon' }),
    ).toThrow(McpConfigImportError);
  });

  it('rejects stdio without a command', () => {
    expect(() => normalizeMcpServerEntry('x', { type: 'stdio' })).toThrow(
      /requires a "command"/,
    );
  });

  it('rejects http without a url', () => {
    expect(() => normalizeMcpServerEntry('x', { type: 'http' })).toThrow(
      /requires a "url"/,
    );
  });

  it('rejects an entry with no way to determine transport', () => {
    expect(() => normalizeMcpServerEntry('x', {})).toThrow(
      /cannot determine transport/,
    );
  });
});

describe('normalizeMcpServerMap', () => {
  it('normalises multiple entries', () => {
    const configs = normalizeMcpServerMap({
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
      fs: { command: 'npx', args: ['-y', 'server-fs'] },
    });
    expect(configs).toHaveLength(2);
    expect(configs.map((c) => c.id).sort()).toEqual(['fs', 'github']);
  });

  it('throws on an empty map', () => {
    expect(() => normalizeMcpServerMap({})).toThrow(McpConfigImportError);
  });

  it('fails the whole import if any entry is invalid (all-or-nothing)', () => {
    expect(() =>
      normalizeMcpServerMap({
        ok: { command: 'x' },
        bad: { type: 'sse', url: 'https://e.com' },
      }),
    ).toThrow(McpConfigImportError);
  });
});
