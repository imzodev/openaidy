import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './env';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');

describe('parseEnv', () => {
  it('defaults to sqlite with a default sqlite path', () => {
    const parsed = parseEnv({});

    expect(parsed.DB_KIND).toBe('sqlite');
    expect(parsed.SQLITE_PATH).toBe('./data/openaidy.db');
    expect(parsed.APP_CONFIG_PATH).toBe(resolve(workspaceRoot, '.openaidy/config.json'));
    expect(parsed.APP_CONFIG_TEMPLATE_PATH).toBe(resolve(workspaceRoot, 'config/openaidy.template.json'));
  });

  it('uses a provided sqlite path', () => {
    const parsed = parseEnv({
      DB_KIND: 'sqlite',
      SQLITE_PATH: './tmp/test.db',
    });

    expect(parsed.DB_KIND).toBe('sqlite');
    expect(parsed.SQLITE_PATH).toBe('./tmp/test.db');
  });

  it('requires DATABASE_URL for postgres mode', () => {
    expect(() => parseEnv({ DB_KIND: 'postgres' })).toThrow(/DATABASE_URL is required/i);
  });

  it('accepts postgres mode with a database url', () => {
    const parsed = parseEnv({
      DB_KIND: 'postgres',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/openaidy',
    });

    expect(parsed.DB_KIND).toBe('postgres');
    expect(parsed.DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/openaidy');
  });
});
