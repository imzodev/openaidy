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

/** A value that is exactly a `${VAR}` placeholder — safe to show, not a secret. */
const PURE_PLACEHOLDER_PATTERN = /^\$\{[^}]+\}$/;

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
 * Keys are always preserved (callers need to know which are set). A value that
 * is exactly a `${VAR}` placeholder is kept verbatim — it is not itself a
 * secret and preserving it lets the UI round-trip the config safely. Any other
 * value may be an inlined secret and is masked.
 */
export function redactSecrets(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return record;

  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    redacted[key] = PURE_PLACEHOLDER_PATTERN.test(value.trim())
      ? value
      : MASKED_VALUE;
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
