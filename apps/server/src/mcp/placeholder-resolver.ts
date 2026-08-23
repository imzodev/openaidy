/**
 * Secret resolution for MCP server `env`/`headers` configs.
 *
 * A record value is one of (see {@link McpSecretValue}):
 * - a legacy plain string, possibly containing `${VAR}` placeholders, e.g.
 *   `{ "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }` — resolved
 *   from the process environment (or the named-secrets store, see below) at
 *   connection time, keeping the raw secret out of the config's literal
 *   template string.
 * - `{ kind: 'env', value }` — the structured form of the above.
 * - `{ kind: 'inline', value }` — a secret encrypted at rest (see
 *   `./secret-crypto`); decrypted at connection time. Never "missing" — the
 *   value is always available once stored.
 *
 * A `${VAR}` placeholder additionally resolves against a named-secrets store
 * (encrypted values a user pasted via the "paste your API key" UI, keyed by
 * variable name — see `AppConfigService.getMcpSecrets`) when unset in the
 * environment. This is what lets a preinstalled server's template string
 * (e.g. Notion's `OPENAPI_MCP_HEADERS` JSON blob) stay byte-identical while
 * still being satisfiable by pasting just the token — the user never edits
 * the template itself.
 *
 * Single responsibility: turn a record of these into a record of resolved
 * plain strings, failing loudly when a referenced `${VAR}` is unset in both
 * sources. The environment source and secrets store are injected so the
 * behaviour is testable without mutating `process.env`.
 */

import type { McpSecretValue } from '@openaidy/shared-types';
import { decryptSecret, isEncryptedSecret } from './secret-crypto';

/**
 * A source of environment variables. Defaults to `process.env` in production;
 * tests inject a plain object.
 */
export type EnvSource = Record<string, string | undefined>;

/**
 * A source of named MCP secrets (`AppConfigService.getMcpSecrets()`), keyed by
 * `${VAR}` name. Values may be `enc:v1:...` ciphertext (decrypted on lookup)
 * or, defensively, plaintext. A function is read live on every lookup — use
 * this in production so a key pasted after the resolver was constructed is
 * picked up without recreating it; tests can pass a plain object.
 */
export type McpSecretsSource =
  | Record<string, string | undefined>
  | (() => Record<string, string | undefined>);

/** Matches `${VAR_NAME}` placeholders. */
const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Thrown when a config references environment variables that are not set.
 * Carries the full list so the caller can surface all of them at once.
 */
export class MissingEnvVarsError extends Error {
  constructor(
    public readonly missing: string[],
    context: string,
  ) {
    super(
      `${context}: missing required environment variable(s): ${missing.join(
        ', ',
      )}. Set them in the server environment before connecting.`,
    );
    this.name = 'MissingEnvVarsError';
  }
}

/**
 * Resolves `${VAR}` placeholders in MCP config records from an env source.
 */
export class EnvPlaceholderResolver {
  constructor(
    private readonly env: EnvSource = process.env,
    private readonly secrets: McpSecretsSource = {},
  ) {}

  /**
   * Look up a `${VAR}` name: the process environment always wins (an ops
   * override of a pasted key), falling back to the named-secrets store.
   */
  private lookup(name: string): string | undefined {
    const fromEnv = this.env[name];
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

    const secrets =
      typeof this.secrets === 'function' ? this.secrets() : this.secrets;
    const fromSecrets = secrets[name];
    if (fromSecrets === undefined || fromSecrets === '') return undefined;
    return isEncryptedSecret(fromSecrets)
      ? decryptSecret(fromSecrets)
      : fromSecrets;
  }

  /**
   * Replace every `${VAR}` in a string with its resolved value, recording any
   * that are unset in both sources (treating empty strings as unset — a
   * blank secret is unusable).
   */
  private resolveString(value: string, missing: Set<string>): string {
    return value.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
      const resolved = this.lookup(name);
      if (resolved === undefined) {
        missing.add(name);
        return '';
      }
      return resolved;
    });
  }

  /**
   * Resolve a single record value to its final plain-string secret.
   * `${VAR}` placeholders (legacy string or `kind: 'env'`) are substituted
   * from the environment, recording unset names into `missing`. Inline
   * secrets are decrypted (or, pre-migration, used as stored plaintext) and
   * never contribute to `missing`.
   */
  private resolveValue(value: McpSecretValue, missing: Set<string>): string {
    if (typeof value === 'string') {
      return this.resolveString(value, missing);
    }
    if (value.kind === 'env') {
      return this.resolveString(value.value, missing);
    }
    return isEncryptedSecret(value.value)
      ? decryptSecret(value.value)
      : value.value;
  }

  /**
   * Resolve every value in a record. Returns a new record; the input is not
   * mutated. `undefined` in → `undefined` out (nothing to resolve).
   *
   * @throws {MissingEnvVarsError} if any referenced variable is unset.
   */
  resolveRecord(
    record: Record<string, McpSecretValue> | undefined,
    context: string,
  ): Record<string, string> | undefined {
    if (!record) return undefined;

    const missing = new Set<string>();
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      resolved[key] = this.resolveValue(value, missing);
    }

    if (missing.size > 0) {
      throw new MissingEnvVarsError([...missing], context);
    }
    return resolved;
  }

  /**
   * Collect the names of `${VAR}` placeholders that are unset (or empty)
   * across one or more records, without throwing. Non-throwing companion to
   * {@link resolveRecord}: lets a caller decide whether a config is ready to
   * use — e.g. skip auto-connecting a server that is still awaiting its API
   * key — rather than treating an unset secret as a connection failure.
   * Inline secrets are always considered present.
   */
  findMissingVars(
    ...records: Array<Record<string, McpSecretValue> | undefined>
  ): string[] {
    const missing = new Set<string>();
    for (const record of records) {
      if (!record) continue;
      for (const value of Object.values(record)) {
        if (typeof value !== 'string' && value.kind === 'inline') continue;
        const toResolve = typeof value === 'string' ? value : value.value;
        // resolveString records unset vars into `missing` as a side effect;
        // its (partially resolved) return value is intentionally discarded.
        this.resolveString(toResolve, missing);
      }
    }
    return [...missing];
  }
}
