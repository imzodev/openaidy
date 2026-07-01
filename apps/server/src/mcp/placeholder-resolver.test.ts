import { describe, it, expect } from 'vitest';
import {
  EnvPlaceholderResolver,
  MissingEnvVarsError,
} from './placeholder-resolver';

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
