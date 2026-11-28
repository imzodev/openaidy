import { randomUUID } from 'node:crypto';
import { AIDY_VERSION } from '../../lib/version';

/** True for OpenCode's hosted endpoints (Go, Zen), by base URL host. */
export function isOpenCodeHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'opencode.ai' || host.endsWith('.opencode.ai');
  } catch (_err) {
    return false;
  }
}

/**
 * The `x-opencode-session` value for a conversation: stable for the same
 * session so OpenCode can route it consistently and reuse its prompt cache.
 * Requests with no conversation (titles, one-off drafts) get a fresh id,
 * which is what a new conversation would send.
 */
export function openCodeSessionId(sessionId: string | undefined): string {
  const id = sessionId?.replace(/[^A-Za-z0-9_-]/g, '');
  return `ses_${id || randomUUID().replace(/-/g, '')}`;
}

/**
 * Extra headers some gateways need on every request. OpenCode Go rejects
 * requests without `x-opencode-session` ("cannot be routed efficiently")
 * and asks clients to identify themselves with their own User-Agent rather
 * than the SDK's. Empty for every other provider.
 */
export function gatewayHeaders(
  baseUrl: string | undefined,
  sessionId: string | undefined,
): Record<string, string> {
  if (!isOpenCodeHost(baseUrl)) return {};
  return {
    'x-opencode-session': openCodeSessionId(sessionId),
    'User-Agent': `aidy/${AIDY_VERSION}`,
  };
}
