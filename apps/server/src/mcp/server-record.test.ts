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

  it('shows a placeholder value with only scaffolding around it (e.g. Bearer ${VAR})', () => {
    expect(redactSecrets({ Authorization: 'Bearer ${GH_TOKEN}' })).toEqual({
      Authorization: 'Bearer ${GH_TOKEN}',
    });
  });

  it('masks a value that inlines a real secret alongside a placeholder', () => {
    // A long opaque literal token remains after stripping the placeholder.
    expect(
      redactSecrets({ Authorization: 'Bearer ghp_realLongLivedToken123 ${X}' }),
    ).toEqual({ Authorization: MASKED_VALUE });
  });

  it('masks a plain non-secret-looking literal too (no placeholder)', () => {
    // No placeholder → treated as possibly sensitive and masked.
    expect(redactSecrets({ NODE_ENV: 'production' })).toEqual({
      NODE_ENV: MASKED_VALUE,
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

  it('shows placeholder templates but masks inlined raw secret values', () => {
    // A placeholder template is not itself a secret — shown so the UI can
    // display and round-trip it.
    const record = toMcpServerRecord(base, { connected: true, tools: [] });
    expect(record.headers).toEqual({ Authorization: 'Bearer ${GH_TOKEN}' });

    // An inlined raw token must never be emitted.
    const withRawSecret = {
      ...base,
      headers: { Authorization: 'Bearer ghp_realLongLivedToken1234567890' },
    } as McpServerConfig;
    const redactedRecord = toMcpServerRecord(withRawSecret, {
      connected: true,
      tools: [],
    });
    expect(redactedRecord.headers).toEqual({ Authorization: MASKED_VALUE });
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
