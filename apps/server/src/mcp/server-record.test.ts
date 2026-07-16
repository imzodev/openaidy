import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '@openaidy/config';
import {
  MASKED_VALUE,
  redactSecrets,
  unmaskRecord,
  toMcpServerRecord,
  migrateInlineSecrets,
  migrateInlineValue,
} from './server-record';
import { decryptSecret, isEncryptedSecret } from './secret-crypto';

describe('redactSecrets', () => {
  it('returns undefined for undefined', () => {
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('preserves keys and pure ${VAR} placeholders (not secrets) as kind env', () => {
    expect(redactSecrets({ TOKEN: '${GH_TOKEN}' })).toEqual({
      TOKEN: { kind: 'env', value: '${GH_TOKEN}' },
    });
  });

  it('masks inlined raw string values as kind inline', () => {
    expect(redactSecrets({ API_KEY: 'sk-supersecret' })).toEqual({
      API_KEY: { kind: 'inline', value: MASKED_VALUE },
    });
  });

  it('shows a placeholder value with only scaffolding around it (e.g. Bearer ${VAR})', () => {
    expect(redactSecrets({ Authorization: 'Bearer ${GH_TOKEN}' })).toEqual({
      Authorization: { kind: 'env', value: 'Bearer ${GH_TOKEN}' },
    });
  });

  it('masks a value that inlines a real secret alongside a placeholder', () => {
    expect(
      redactSecrets({ Authorization: 'Bearer ghp_realLongLivedToken123 ${X}' }),
    ).toEqual({ Authorization: { kind: 'inline', value: MASKED_VALUE } });
  });

  it('masks an inlined credential even when a placeholder co-occurs (no long run)', () => {
    expect(
      redactSecrets({
        DATABASE_URL: 'postgres://admin:S3cr3t@db.example.com/${DBNAME}',
      }),
    ).toEqual({ DATABASE_URL: { kind: 'inline', value: MASKED_VALUE } });
  });

  it('masks a plain non-secret-looking literal too (no placeholder)', () => {
    expect(redactSecrets({ NODE_ENV: 'production' })).toEqual({
      NODE_ENV: { kind: 'inline', value: MASKED_VALUE },
    });
  });

  it('passes through an explicit kind: env value verbatim', () => {
    expect(
      redactSecrets({
        Authorization: { kind: 'env', value: 'Bearer ${GH_TOKEN}' },
      }),
    ).toEqual({ Authorization: { kind: 'env', value: 'Bearer ${GH_TOKEN}' } });
  });

  it('always masks an explicit kind: inline value, whether encrypted or not', () => {
    expect(
      redactSecrets({ API_KEY: { kind: 'inline', value: 'enc:v1:whatever' } }),
    ).toEqual({ API_KEY: { kind: 'inline', value: MASKED_VALUE } });
    expect(
      redactSecrets({ API_KEY: { kind: 'inline', value: 'plaintext-secret' } }),
    ).toEqual({ API_KEY: { kind: 'inline', value: MASKED_VALUE } });
  });
});

describe('unmaskRecord', () => {
  it('returns existing when patch is undefined (field not supplied)', () => {
    expect(unmaskRecord(undefined, { A: 'keep' })).toEqual({ A: 'keep' });
  });

  it('keeps the stored value when the client echoes back a masked inline placeholder', () => {
    expect(
      unmaskRecord(
        { Authorization: { kind: 'inline', value: MASKED_VALUE } },
        { Authorization: { kind: 'inline', value: 'enc:v1:stored-cipher' } },
      ),
    ).toEqual({
      Authorization: { kind: 'inline', value: 'enc:v1:stored-cipher' },
    });
  });

  it('stores kind: env values verbatim (plaintext ${VAR} reference)', () => {
    expect(
      unmaskRecord(
        { Authorization: { kind: 'env', value: 'Bearer ${TOKEN}' } },
        undefined,
      ),
    ).toEqual({ Authorization: { kind: 'env', value: 'Bearer ${TOKEN}' } });
  });

  it('encrypts a genuinely new/replaced inline secret before storage', () => {
    const result = unmaskRecord(
      { Authorization: { kind: 'inline', value: 'ghp_realtoken123' } },
      undefined,
    );
    const stored = result!.Authorization as { kind: string; value: string };
    expect(stored.kind).toBe('inline');
    expect(stored.value).not.toBe('ghp_realtoken123');
    expect(isEncryptedSecret(stored.value)).toBe(true);
    expect(decryptSecret(stored.value)).toBe('ghp_realtoken123');
  });

  it('normalizes a legacy plain-string patch by content (env scaffolding vs inline)', () => {
    const result = unmaskRecord(
      { TOKEN: '${GH_TOKEN}', SECRET: 'ghp_realLongLivedToken1234567890' },
      undefined,
    );
    expect(result!.TOKEN).toBe('${GH_TOKEN}');
    const secret = result!.SECRET as { kind: string; value: string };
    expect(secret.kind).toBe('inline');
    expect(isEncryptedSecret(secret.value)).toBe(true);
    expect(decryptSecret(secret.value)).toBe(
      'ghp_realLongLivedToken1234567890',
    );
  });

  it('supports adding and removing keys (full-replace semantics)', () => {
    const result = unmaskRecord({ B: '${VAR}' }, { A: 'gone' });
    expect(result).toEqual({ B: '${VAR}' });
    expect(Object.keys(result!)).toEqual(['B']);
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
    const record = toMcpServerRecord(base, { connected: true, tools: [] });
    expect(record.headers).toEqual({
      Authorization: { kind: 'env', value: 'Bearer ${GH_TOKEN}' },
    });

    const withRawSecret = {
      ...base,
      headers: { Authorization: 'Bearer ghp_realLongLivedToken1234567890' },
    } as McpServerConfig;
    const redactedRecord = toMcpServerRecord(withRawSecret, {
      connected: true,
      tools: [],
    });
    expect(redactedRecord.headers).toEqual({
      Authorization: { kind: 'inline', value: MASKED_VALUE },
    });
  });

  it('masks a structured inline secret regardless of encryption state', () => {
    const withInline = {
      ...base,
      headers: {
        Authorization: { kind: 'inline' as const, value: 'enc:v1:abc' },
      },
    } as McpServerConfig;
    const record = toMcpServerRecord(withInline, {
      connected: true,
      tools: [],
    });
    expect(record.headers).toEqual({
      Authorization: { kind: 'inline', value: MASKED_VALUE },
    });
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

describe('migrateInlineValue', () => {
  it('passes through an already-encrypted inline value unchanged', () => {
    const encrypted = 'enc:v1:abc123';
    expect(migrateInlineValue({ kind: 'inline', value: encrypted })).toEqual({
      kind: 'inline',
      value: encrypted,
    });
  });

  it('encrypts a structured inline value still holding plaintext', () => {
    const result = migrateInlineValue({
      kind: 'inline',
      value: 'ghp_realPlaintextToken123',
    }) as { kind: string; value: string };
    expect(result.kind).toBe('inline');
    expect(result.value).not.toBe('ghp_realPlaintextToken123');
    expect(isEncryptedSecret(result.value)).toBe(true);
    expect(decryptSecret(result.value)).toBe('ghp_realPlaintextToken123');
  });

  it('keeps a pure ${VAR} placeholder as a plain string', () => {
    expect(migrateInlineValue('${GH_TOKEN}')).toBe('${GH_TOKEN}');
  });

  it('keeps a Bearer-scaffolded ${VAR} as a plain string', () => {
    expect(migrateInlineValue('Bearer ${GH_TOKEN}')).toBe('Bearer ${GH_TOKEN}');
  });

  it('encrypts a legacy plain string with no ${VAR} (an inlined credential)', () => {
    const result = migrateInlineValue('ghp_realLongLivedToken1234567890') as {
      kind: string;
      value: string;
    };
    expect(result.kind).toBe('inline');
    expect(isEncryptedSecret(result.value)).toBe(true);
    expect(decryptSecret(result.value)).toBe(
      'ghp_realLongLivedToken1234567890',
    );
  });

  it('encrypts a string that mixes a real secret with a ${VAR} placeholder', () => {
    const result = migrateInlineValue(
      'Bearer ghp_realLongLivedToken123 ${X}',
    ) as { kind: string; value: string };
    expect(result.kind).toBe('inline');
    expect(isEncryptedSecret(result.value)).toBe(true);
    expect(decryptSecret(result.value)).toBe(
      'Bearer ghp_realLongLivedToken123 ${X}',
    );
  });

  it('passes through an explicit kind: env value unchanged', () => {
    expect(
      migrateInlineValue({ kind: 'env', value: 'Bearer ${GH_TOKEN}' }),
    ).toEqual({ kind: 'env', value: 'Bearer ${GH_TOKEN}' });
  });

  it('is idempotent: migrating twice yields the same encrypted form', () => {
    const once = migrateInlineValue('ghp_realTokenABC');
    const twice = migrateInlineValue(once);
    expect(once).toEqual(twice);
  });
});

describe('migrateInlineSecrets', () => {
  it('returns undefined for undefined (passthrough)', () => {
    expect(migrateInlineSecrets(undefined)).toBeUndefined();
  });

  it('rewrites every plaintext inline value, leaves env refs and already-encrypted values alone', () => {
    const record = {
      GITHUB_TOKEN: '${GH_TOKEN}',
      Authorization: 'Bearer ${GH_TOKEN}',
      API_KEY: 'ghp_realLongLivedToken1234567890',
      STRIPE_KEY: { kind: 'inline' as const, value: 'sk_test_plaintext_value' },
      ALREADY_ENC: { kind: 'inline' as const, value: 'enc:v1:preexisting' },
    };
    const migrated = migrateInlineSecrets(record)!;

    // Pure placeholder and Bearer-scaffolded placeholder stay plain.
    expect(migrated.GITHUB_TOKEN).toBe('${GH_TOKEN}');
    expect(migrated.Authorization).toBe('Bearer ${GH_TOKEN}');

    // Plaintext → encrypted.
    const apiKey = migrated.API_KEY as { kind: string; value: string };
    expect(apiKey.kind).toBe('inline');
    expect(isEncryptedSecret(apiKey.value)).toBe(true);
    expect(decryptSecret(apiKey.value)).toBe(
      'ghp_realLongLivedToken1234567890',
    );

    const stripe = migrated.STRIPE_KEY as { kind: string; value: string };
    expect(stripe.kind).toBe('inline');
    expect(isEncryptedSecret(stripe.value)).toBe(true);
    expect(decryptSecret(stripe.value)).toBe('sk_test_plaintext_value');

    // Already-encrypted inline is left as-is (same string identity).
    expect(migrated.ALREADY_ENC).toEqual({
      kind: 'inline',
      value: 'enc:v1:preexisting',
    });
  });

  it('is idempotent across multiple invocations', () => {
    const record = {
      API_KEY: 'ghp_realLongLivedToken1234567890',
      NODE_ENV: 'production',
    };
    const first = migrateInlineSecrets(record);
    const second = migrateInlineSecrets(first);
    expect(second).toEqual(first);
  });

  it('preserves the set of keys', () => {
    const record = {
      A: '${X}',
      B: 'plaintextSecretABCDEF',
      C: { kind: 'inline' as const, value: 'enc:v1:xyz' },
    };
    const migrated = migrateInlineSecrets(record)!;
    expect(Object.keys(migrated).sort()).toEqual(['A', 'B', 'C']);
  });
});
