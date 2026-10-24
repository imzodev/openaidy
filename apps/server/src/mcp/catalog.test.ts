import { describe, it, expect } from 'vitest';
import { mcpServerConfigSchema } from '@openaidy/config';
import { MCP_CATALOG, catalogServerConfig, findCatalogEntry } from './catalog';

describe('MCP catalog', () => {
  it('has unique ids', () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry produces a valid https OAuth server config', () => {
    for (const entry of MCP_CATALOG) {
      const config = catalogServerConfig(entry, { clientId: 'cid' });
      expect(mcpServerConfigSchema.safeParse(config).success).toBe(true);
      expect(config.url?.startsWith('https://')).toBe(true);
      expect(config.auth?.type).toBe('oauth');
    }
  });

  it('own-app entries declare scopes and take the client credentials', () => {
    const gmail = findCatalogEntry('gmail')!;
    expect(gmail.setup).toBe('oauth-own-app');
    const config = catalogServerConfig(gmail, {
      clientId: ' cid ',
      clientSecret: 'secret',
    });
    expect(config.auth).toEqual({
      type: 'oauth',
      clientId: 'cid',
      clientSecret: { kind: 'inline', value: 'secret' },
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    });
  });

  it('one-click entries ignore client credentials', () => {
    const config = catalogServerConfig(findCatalogEntry('stripe')!, {
      clientId: 'ignored',
      clientSecret: 'ignored',
    });
    expect(config.auth).toEqual({ type: 'oauth' });
  });

  it('API-token installs use a header instead of OAuth', () => {
    const config = catalogServerConfig(findCatalogEntry('digitalocean')!, {
      apiKey: ' dop_v1_abc ',
    });
    expect(config.auth).toBeUndefined();
    expect(config.headers).toEqual({
      Authorization: { kind: 'inline', value: 'Bearer dop_v1_abc' },
    });
  });

  it('ignores an API token for entries without that option', () => {
    const config = catalogServerConfig(findCatalogEntry('stripe')!, {
      apiKey: 'x',
    });
    expect(config.headers).toBeUndefined();
    expect(config.auth).toEqual({ type: 'oauth' });
  });
});
