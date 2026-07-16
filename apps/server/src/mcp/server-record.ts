/**
 * MCP server API representation.
 *
 * Single source of truth for turning a stored {@link McpServerConfig} plus its
 * live runtime status into the {@link McpServerRecord} returned by the REST
 * API. Centralising this here removes the record-building duplication across
 * the route handlers and — critically — guarantees that secret values in
 * `env`/`headers` are never emitted over the API.
 *
 * `env`/`headers` values come in two kinds (see {@link McpSecretValue}):
 * - `{ kind: 'env', value }` — a `${VAR}` reference. The secret lives in the
 *   process environment, not the config, so it's safe to show verbatim.
 * - `{ kind: 'inline', value }` — a value pasted directly into the form.
 *   `value` is ciphertext (`enc:v1:...`, see `./secret-crypto`) once
 *   encrypted, or legacy plaintext awaiting migration — either way it is
 *   never shown, always redacted to {@link MASKED_VALUE}.
 *
 * A plain string is also accepted (backward compatibility with existing
 * configs and import formats); its kind is inferred from content via
 * {@link isSafeToShow}.
 */

import type { McpServerConfig } from '@openaidy/config';
import type {
  McpSecretField,
  McpSecretValue,
  McpServerRecord,
  McpToolSummary,
} from '@openaidy/shared-types';
import { encryptSecret, isEncryptedSecret } from './secret-crypto';

/**
 * Placeholder returned in place of a secret config value. Also recognised on
 * the way back in ({@link unmaskRecord}) so a round-tripped redacted value
 * never overwrites the stored secret.
 */
export const MASKED_VALUE = '••••••';

/** A `${VAR}` placeholder occurring anywhere in a value. */
const PLACEHOLDER_PATTERN = /\$\{[^}]+\}/g;

/**
 * Literal (non-placeholder) text that is safe to reveal alongside a `${VAR}`
 * placeholder: auth-scheme words and spacing only. Anything else — digits, `:`
 * `/` `@` `=` `.` `_`, etc. — could be part of an inlined credential (a URL with
 * an embedded password, an API token), so a value containing it is masked.
 */
const SAFE_SCAFFOLDING_PATTERN = /^[A-Za-z \t-]*$/;

/**
 * Whether a legacy plain-string value is safe to show verbatim in API output
 * (kind `env`) rather than masked (kind `inline`).
 *
 * Safe only when the value references its secret through one or more `${VAR}`
 * placeholders — the actual secret lives in the environment, not the config —
 * AND the remaining literal text is nothing but auth-scheme scaffolding (e.g.
 * `${TOKEN}` or `Bearer ${TOKEN}`). A value with no placeholder, or whose
 * literal part contains anything that could be an inlined secret (digits, URL
 * punctuation, a token), is treated as inline. Deliberately conservative:
 * better to mask a benign value than to leak a credential inlined next to a
 * placeholder — e.g. `postgres://user:pass@host/${DB}` must never be shown.
 */
function isSafeToShow(value: string): boolean {
  const trimmed = value.trim();
  if (!/\$\{[^}]+\}/.test(trimmed)) return false;
  const literal = trimmed.replace(PLACEHOLDER_PATTERN, ' ');
  return SAFE_SCAFFOLDING_PATTERN.test(literal);
}

/** Live connection state for a server, as seen by the client service. */
export type McpRuntimeStatus = {
  connected: boolean;
  tools: McpToolSummary[];
  /**
   * `${VAR}` secret placeholders referenced by the server but not yet set in
   * the environment. Omitted → treated as none (fully configured).
   */
  missingSecrets?: string[];
};

/** Normalize a single `env`/`headers` value into its redacted API shape. */
function redactValue(value: McpSecretValue): McpSecretField {
  if (typeof value === 'string') {
    return isSafeToShow(value)
      ? { kind: 'env', value }
      : { kind: 'inline', value: MASKED_VALUE };
  }
  if (value.kind === 'env') {
    return { kind: 'env', value: value.value };
  }
  // kind === 'inline': always masked, whether already encrypted at rest or
  // legacy plaintext awaiting migration.
  return { kind: 'inline', value: MASKED_VALUE };
}

/**
 * Redact secret values in an `env`/`headers` record for API output.
 *
 * Keys are always preserved (callers need to know which are set). See
 * {@link redactValue} for the per-value rule.
 */
export function redactSecrets(
  record: Record<string, McpSecretValue> | undefined,
): Record<string, McpSecretField> | undefined {
  if (!record) return undefined;

  const redacted: Record<string, McpSecretField> = {};
  for (const [key, value] of Object.entries(record)) {
    redacted[key] = redactValue(value);
  }
  return redacted;
}

/**
 * Normalize an incoming legacy plain-string value for storage: env-var
 * scaffolding is kept as-is (plaintext is fine — the secret itself lives in
 * the environment), anything else is treated as an inline secret and
 * encrypted at rest.
 */
function normalizeIncomingString(value: string): McpSecretValue {
  return isSafeToShow(value)
    ? value
    : { kind: 'inline', value: encryptSecret(value) };
}

/**
 * Rewrite a single `env`/`headers` value for in-place migration to the
 * encrypted-at-rest format.
 *
 * - Already-encrypted structured values (`{ kind: 'inline', value: 'enc:v1:…' }`)
 *   are returned unchanged.
 * - Env-var references (legacy `${VAR}` strings, or structured
 *   `{ kind: 'env', value }`) are returned unchanged — their secret lives in
 *   the process environment, not the config.
 * - Anything else — a legacy plain string that doesn't look like a pure
 *   `${VAR}` reference, or a structured `{ kind: 'inline', value }` still
 *   holding plaintext from a pre-#401 install — is encrypted at rest.
 */
export function migrateInlineValue(value: McpSecretValue): McpSecretValue {
  if (typeof value === 'string') {
    return normalizeIncomingString(value);
  }
  if (value.kind === 'env') {
    return value;
  }
  // value.kind === 'inline'
  if (isEncryptedSecret(value.value)) {
    return value;
  }
  return { kind: 'inline', value: encryptSecret(value.value) };
}

/**
 * In-place rewrite of one `env`/`headers` record for migration. `undefined`
 * passes through unchanged; keys are preserved; the returned record is safe
 * to persist via {@link AppConfigService.save}.
 */
export function migrateInlineSecrets(
  record: Record<string, McpSecretValue> | undefined,
): Record<string, McpSecretValue> | undefined {
  if (!record) return record;
  const migrated: Record<string, McpSecretValue> = {};
  for (const [key, value] of Object.entries(record)) {
    migrated[key] = migrateInlineValue(value);
  }
  return migrated;
}

/**
 * Resolve a single incoming (possibly redacted) `env`/`headers` value against
 * the stored value it would replace.
 *
 * - `{ kind: 'env', value }` is stored as-is (plaintext `${VAR}` reference).
 * - `{ kind: 'inline', value: MASKED_VALUE }` means "unchanged" — the client
 *   echoed back the redacted display value without ever seeing the secret —
 *   so the stored value is retained.
 * - `{ kind: 'inline', value }` (anything else) is a new/replaced secret:
 *   encrypted before storage.
 * - A legacy plain string equal to `MASKED_VALUE` is also treated as
 *   "unchanged" (same safety net, for a client that echoes the redacted
 *   value back as a bare string rather than the structured shape); anything
 *   else is normalized via {@link normalizeIncomingString}.
 */
function resolveIncomingValue(
  incoming: McpSecretValue,
  existing: McpSecretValue | undefined,
): McpSecretValue {
  if (typeof incoming === 'string') {
    if (incoming === MASKED_VALUE) {
      return existing ?? incoming;
    }
    return normalizeIncomingString(incoming);
  }
  if (incoming.kind === 'env') {
    return { kind: 'env', value: incoming.value };
  }
  if (incoming.value === MASKED_VALUE) {
    return existing ?? incoming;
  }
  return { kind: 'inline', value: encryptSecret(incoming.value) };
}

/**
 * Merge an incoming (possibly redacted) `env`/`headers` patch onto the stored
 * record, encrypting any newly-supplied inline secrets before they reach
 * disk. `undefined` patch means the field was not supplied at all — the
 * existing record (if any) is kept unchanged.
 */
export function unmaskRecord(
  patch: Record<string, McpSecretValue> | undefined,
  existing: Record<string, McpSecretValue> | undefined,
): Record<string, McpSecretValue> | undefined {
  if (patch === undefined) return existing;

  const merged: Record<string, McpSecretValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = resolveIncomingValue(value, existing?.[key]);
  }
  return merged;
}

/**
 * Build the API representation of an MCP server, with secrets redacted.
 */
export function toMcpServerRecord(
  config: McpServerConfig,
  runtime: McpRuntimeStatus,
): McpServerRecord {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    command: config.command,
    args: config.args,
    env: redactSecrets(config.env),
    url: config.url,
    headers: redactSecrets(config.headers),
    connected: runtime.connected,
    toolCount: runtime.tools.length,
    tools: runtime.tools,
    missingSecrets: runtime.missingSecrets ?? [],
  };
}
