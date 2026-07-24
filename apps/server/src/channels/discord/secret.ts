import type { McpSecretValue } from '@openaidy/config';
import { decryptSecret, isEncryptedSecret } from '../../mcp/secret-crypto.js';

/**
 * Resolve a channel bot token to its plaintext value.
 *
 * - `{ kind: 'env', value }` → read `process.env[value]` (throws if unset).
 * - `{ kind: 'inline', value }` → decrypt if it is `enc:v1:` ciphertext,
 *   otherwise return the (legacy) plaintext as-is.
 * - legacy plain string → treated as an inline plaintext token.
 *
 * Mirrors the MCP secret resolution in `mcp/placeholder-resolver.ts`.
 */
export function resolveBotToken(token: McpSecretValue): string {
  if (typeof token === 'string') {
    return token;
  }
  if (token.kind === 'env') {
    const value = process.env[token.value];
    if (!value) {
      throw new Error(`Discord bot token env var "${token.value}" is not set`);
    }
    return value;
  }
  return isEncryptedSecret(token.value)
    ? decryptSecret(token.value)
    : token.value;
}
