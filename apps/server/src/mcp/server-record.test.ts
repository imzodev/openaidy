import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '@openaidy/config';
import {
  MASKED_VALUE,
  redactSecrets,
  unmaskRecord,
  toMcpServerRecord,
} from './server-record';

describe('redactSecrets', () => {
  it('returns undefined for undefined', () => {
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('preserves keys and pure ${VAR} placeholders (not secrets)', () => {
    expect(redactSecrets({ TOKEN: '${GH_TOKEN}' })).toEqual({
      TOKEN: '${GH_TOKEN}',
    });
  });

  it('masks inlined raw values', () => {
    expect(redactSecrets({ API_KEY: 'sk-supersecret' })).toEqual({
      API_KEY: MASKED_VALUE,
    });
  });

  it('masks mixed values that embed a placeholder (e.g. Bearer ${VAR})', () => {
    expect(redactSecrets({ Authorization: 'Bearer ${GH_TOKEN}' })).toEqual({
      Authorization: MASKED_VALUE,
    });
  });
});

describe('unmaskRecord', () => {
  it('returns existing when patch is undefined (field not supplied)', () => {
    expect(unmaskRecord(undefined, { A: 'keep' })).toEqual({ A: 'keep' });
  });

  it('keeps the stored value when the client echoes back a masked value', () => {
    expect(
      unmaskRecord({ Authorization: MASKED_VALUE }, { Authorization: 'real' }),
    ).toEqual({ Authorization: 'real' });
  });

  it('applies genuinely changed values', () => {
    expect(
      unmaskRecord({ Authorization: 'new' }, { Authorization: 'old' }),
    ).toEqual({ Authorization: 'new' });
  });

  it('supports adding and removing keys (full-replace semantics)', () => {
    expect(unmaskRecord({ B: 'added' }, { A: 'gone' })).toEqual({ B: 'added' });
  });
});

describe('toMcpServerRecord', () => {
  const base: McpServerConfig = {
    id: 'gh',
    name: 'GitHub',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer ${GH_TOKEN}' },
  } as McpServerConfig;

  it('never emits raw secret header/env values', () => {
    const record = toMcpServerRecord(base, { connected: true, tools: [] });
    expect(record.headers).toEqual({ Authorization: MASKED_VALUE });
  });

  it('reflects runtime status and tool count', () => {
    const record = toMcpServerRecord(base, {
      connected: true,
      tools: [{ name: 'search' }, { name: 'issues' }],
    });
    expect(record.connected).toBe(true);
    expect(record.toolCount).toBe(2);
    expect(record.tools.map((t) => t.name)).toEqual(['search', 'issues']);
  });
});
