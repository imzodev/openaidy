import { describe, it, expect } from 'vitest';
import {
  EnvPlaceholderResolver,
  MissingEnvVarsError,
} from './placeholder-resolver';
import { encryptSecret } from './secret-crypto';

describe('EnvPlaceholderResolver', () => {
  const env = {
    GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret',
    API_KEY: 'sk-123',
    EMPTY: '',
  };

  it('returns undefined for an undefined record', () => {
    const resolver = new EnvPlaceholderResolver(env);
    expect(resolver.resolveRecord(undefined, 'ctx')).toBeUndefined();
  });

  it('resolves a ${VAR} placeholder embedded in a value', () => {
    const resolver = new EnvPlaceholderResolver(env);
    const resolved = resolver.resolveRecord(
      { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
      'headers',
    );
    expect(resolved).toEqual({ Authorization: 'Bearer ghp_secret' });
  });

  it('resolves multiple placeholders across multiple keys', () => {
    const resolver = new EnvPlaceholderResolver(env);
    const resolved = resolver.resolveRecord(
      { A: '${API_KEY}', B: 'x-${GITHUB_PERSONAL_ACCESS_TOKEN}-y' },
      'env',
    );
    expect(resolved).toEqual({ A: 'sk-123', B: 'x-ghp_secret-y' });
  });

  it('leaves values without placeholders untouched', () => {
    const resolver = new EnvPlaceholderResolver(env);
    expect(resolver.resolveRecord({ PLAIN: 'literal' }, 'env')).toEqual({
      PLAIN: 'literal',
    });
  });

  it('does not mutate the input record', () => {
    const resolver = new EnvPlaceholderResolver(env);
    const input = { A: '${API_KEY}' };
    resolver.resolveRecord(input, 'env');
    expect(input).toEqual({ A: '${API_KEY}' });
  });

  it('throws MissingEnvVarsError listing all unset variables', () => {
    const resolver = new EnvPlaceholderResolver(env);
    try {
      resolver.resolveRecord(
        { A: '${NOT_SET}', B: '${ALSO_MISSING}' },
        'MCP server gh headers',
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvVarsError);
      const e = err as MissingEnvVarsError;
      expect(e.missing).toEqual(['NOT_SET', 'ALSO_MISSING']);
      expect(e.message).toContain('MCP server gh headers');
    }
  });

  it('treats an empty-string env value as missing (unusable secret)', () => {
    const resolver = new EnvPlaceholderResolver(env);
    expect(() => resolver.resolveRecord({ A: '${EMPTY}' }, 'env')).toThrow(
      MissingEnvVarsError,
    );
  });

  describe('findMissingVars', () => {
    it('returns the names of unset (or empty) placeholders without throwing', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(
        resolver.findMissingVars({
          A: '${API_KEY}', // set
          B: '${NOT_SET}', // unset
          C: '${EMPTY}', // empty → treated as unset
        }),
      ).toEqual(['NOT_SET', 'EMPTY']);
    });

    it('returns an empty array when every placeholder resolves', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(resolver.findMissingVars({ A: 'Bearer ${API_KEY}' })).toEqual([]);
    });

    it('has no placeholders → nothing missing', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(resolver.findMissingVars({ A: 'literal' })).toEqual([]);
    });

    it('dedupes and spans multiple records, skipping undefined ones', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(
        resolver.findMissingVars({ A: '${NOT_SET}' }, undefined, {
          B: '${NOT_SET}',
          C: '${OTHER_MISSING}',
        }),
      ).toEqual(['NOT_SET', 'OTHER_MISSING']);
    });
  });

  describe('structured kind: env / kind: inline values', () => {
    it('resolves a kind: env value the same as a legacy string', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(
        resolver.resolveRecord(
          { Authorization: { kind: 'env', value: 'Bearer ${API_KEY}' } },
          'headers',
        ),
      ).toEqual({ Authorization: 'Bearer sk-123' });
    });

    it('decrypts an encrypted kind: inline value and never treats it as missing', () => {
      const resolver = new EnvPlaceholderResolver(env);
      const encrypted = encryptSecret('ghp_realtoken');
      expect(
        resolver.resolveRecord(
          { Authorization: { kind: 'inline', value: encrypted } },
          'headers',
        ),
      ).toEqual({ Authorization: 'ghp_realtoken' });
    });

    it('uses a not-yet-encrypted kind: inline value as-is', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(
        resolver.resolveRecord(
          { Authorization: { kind: 'inline', value: 'plaintext-secret' } },
          'headers',
        ),
      ).toEqual({ Authorization: 'plaintext-secret' });
    });

    it('never reports a kind: inline value as missing', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(
        resolver.findMissingVars({
          A: { kind: 'inline', value: encryptSecret('x') },
        }),
      ).toEqual([]);
    });

    it('reports an unset ${VAR} inside a kind: env value as missing', () => {
      const resolver = new EnvPlaceholderResolver(env);
      expect(
        resolver.findMissingVars({
          A: { kind: 'env', value: '${NOT_SET}' },
        }),
      ).toEqual(['NOT_SET']);
    });
  });

  describe('named-secrets store fallback', () => {
    it('resolves a ${VAR} from the secrets store when unset in the environment', () => {
      const resolver = new EnvPlaceholderResolver(env, {
        NOTION_TOKEN: encryptSecret('secret_abc'),
      });
      expect(
        resolver.resolveRecord({ A: 'Bearer ${NOTION_TOKEN}' }, 'env'),
      ).toEqual({ A: 'Bearer secret_abc' });
    });

    it('uses a not-yet-encrypted secrets-store value as-is', () => {
      const resolver = new EnvPlaceholderResolver(env, {
        NOTION_TOKEN: 'plaintext-token',
      });
      expect(resolver.resolveRecord({ A: '${NOTION_TOKEN}' }, 'env')).toEqual({
        A: 'plaintext-token',
      });
    });

    it('prefers the process environment over the secrets store when both are set', () => {
      const resolver = new EnvPlaceholderResolver(
        { ...env, NOTION_TOKEN: 'from-env' },
        { NOTION_TOKEN: encryptSecret('from-store') },
      );
      expect(resolver.resolveRecord({ A: '${NOTION_TOKEN}' }, 'env')).toEqual({
        A: 'from-env',
      });
    });

    it('findMissingVars is satisfied by a secrets-store value alone', () => {
      const resolver = new EnvPlaceholderResolver(env, {
        NOTION_TOKEN: encryptSecret('secret_abc'),
      });
      expect(resolver.findMissingVars({ A: '${NOTION_TOKEN}' })).toEqual([]);
    });

    it('reports missing when neither the environment nor the secrets store has it', () => {
      const resolver = new EnvPlaceholderResolver(env, {});
      expect(() =>
        resolver.resolveRecord({ A: '${NOTION_TOKEN}' }, 'env'),
      ).toThrow(MissingEnvVarsError);
      expect(resolver.findMissingVars({ A: '${NOTION_TOKEN}' })).toEqual([
        'NOTION_TOKEN',
      ]);
    });

    it('treats an empty stored secret as unset', () => {
      const resolver = new EnvPlaceholderResolver(env, { NOTION_TOKEN: '' });
      expect(resolver.findMissingVars({ A: '${NOTION_TOKEN}' })).toEqual([
        'NOTION_TOKEN',
      ]);
    });

    it('reads a function secrets source live on every lookup', () => {
      let stored: Record<string, string> = {};
      const resolver = new EnvPlaceholderResolver(env, () => stored);
      expect(resolver.findMissingVars({ A: '${NOTION_TOKEN}' })).toEqual([
        'NOTION_TOKEN',
      ]);
      stored = { NOTION_TOKEN: encryptSecret('secret_abc') };
      expect(resolver.findMissingVars({ A: '${NOTION_TOKEN}' })).toEqual([]);
      expect(resolver.resolveRecord({ A: '${NOTION_TOKEN}' }, 'env')).toEqual({
        A: 'secret_abc',
      });
    });
  });

  it('defaults to process.env when no source is injected', () => {
    process.env.__MCP_TEST_VAR__ = 'from-process-env';
    try {
      const resolver = new EnvPlaceholderResolver();
      expect(
        resolver.resolveRecord({ X: '${__MCP_TEST_VAR__}' }, 'env'),
      ).toEqual({ X: 'from-process-env' });
    } finally {
      delete process.env.__MCP_TEST_VAR__;
    }
  });
});
