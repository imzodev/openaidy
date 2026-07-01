/**
 * Environment placeholder resolution for MCP server configs.
 *
 * MCP configs may reference secrets indirectly with `${VAR}` placeholders,
 * e.g. `{ "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }`. This
 * keeps raw secrets out of the persisted config (and out of API responses),
 * resolving them from the process environment only at connection time.
 *
 * Single responsibility: turn a record of placeholder-bearing strings into a
 * record of resolved strings, failing loudly when a referenced variable is
 * unset. The environment source is injected so the behaviour is testable
 * without mutating `process.env`.
 */

/**
 * A source of environment variables. Defaults to `process.env` in production;
 * tests inject a plain object.
 */
export type EnvSource = Record<string, string | undefined>;

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
  constructor(private readonly env: EnvSource = process.env) {}

  /**
   * Replace every `${VAR}` in a string with its env value, recording any that
   * are unset (treating empty strings as unset — a blank secret is unusable).
   */
  private resolveString(value: string, missing: Set<string>): string {
    return value.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
      const resolved = this.env[name];
      if (resolved === undefined || resolved === '') {
        missing.add(name);
        return '';
      }
      return resolved;
    });
  }

  /**
   * Resolve every value in a record. Returns a new record; the input is not
   * mutated. `undefined` in → `undefined` out (nothing to resolve).
   *
   * @throws {MissingEnvVarsError} if any referenced variable is unset.
   */
  resolveRecord(
    record: Record<string, string> | undefined,
    context: string,
  ): Record<string, string> | undefined {
    if (!record) return record;

    const missing = new Set<string>();
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      resolved[key] = this.resolveString(value, missing);
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
   */
  findMissingVars(
    ...records: Array<Record<string, string> | undefined>
  ): string[] {
    const missing = new Set<string>();
    for (const record of records) {
      if (!record) continue;
      for (const value of Object.values(record)) {
        // resolveString records unset vars into `missing` as a side effect;
        // its (partially resolved) return value is intentionally discarded.
        this.resolveString(value, missing);
      }
    }
    return [...missing];
  }
}
