/**
 * MCP server API representation.
 *
 * Single source of truth for turning a stored {@link McpServerConfig} plus its
 * live runtime status into the {@link McpServerRecord} returned by the REST
 * API. Centralising this here removes the record-building duplication across
 * the route handlers and — critically — guarantees that secret values in
 * `env`/`headers` are never emitted over the API.
 */

import type { McpServerConfig } from '@openaidy/config';
import type { McpServerRecord, McpToolSummary } from '@openaidy/shared-types';

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
 * Whether a value is safe to show verbatim in API output rather than masked.
 *
 * Safe only when the value references its secret through one or more `${VAR}`
 * placeholders — the actual secret lives in the environment, not the config —
 * AND the remaining literal text is nothing but auth-scheme scaffolding (e.g.
 * `${TOKEN}` or `Bearer ${TOKEN}`). A value with no placeholder, or whose
 * literal part contains anything that could be an inlined secret (digits, URL
 * punctuation, a token), is masked. Deliberately conservative: better to mask a
 * benign value than to leak a credential inlined next to a placeholder — e.g.
 * `postgres://user:pass@host/${DB}` must never be shown.
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

/**
 * Redact secret values in an `env`/`headers` record for API output.
 *
 * Keys are always preserved (callers need to know which are set). A value whose
 * only sensitive content is a `${VAR}` placeholder is kept verbatim — the
 * secret itself lives in the environment, and preserving the template (e.g.
 * `Bearer ${TOKEN}`) lets the UI show what's needed and round-trip the config
 * safely. Any value that looks like an inlined secret is masked. See
 * {@link isSafeToShow}.
 */
export function redactSecrets(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return record;

  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    redacted[key] = isSafeToShow(value) ? value : MASKED_VALUE;
  }
  return redacted;
}

/**
 * Merge an incoming (possibly redacted) `env`/`headers` patch onto the stored
 * record. A value equal to {@link MASKED_VALUE} means "unchanged" — the client
 * echoed back a redacted value it never actually saw — so the stored value is
 * retained. `undefined` patch means the field was not supplied at all.
 */
export function unmaskRecord(
  patch: Record<string, string> | undefined,
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (patch === undefined) return existing;

  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = value === MASKED_VALUE ? (existing?.[key] ?? value) : value;
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
