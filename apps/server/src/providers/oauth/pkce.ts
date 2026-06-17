import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (Proof Key for Code Exchange) helpers.
 *
 * Used by OAuth flows that don't have a per-developer client_secret
 * (public clients, device-code, desktop apps, SPAs).
 *
 * The flow:
 *   1. At /start, we generate a random `verifier` and its S256 `challenge`.
 *   2. We send `challenge` to the provider along with the authorization request.
 *   3. At /callback, we send `verifier` to the provider to prove we are
 *      the same client that started the flow.
 *
 * The provider only stores the challenge; the verifier is never sent in
 * the authorization request, so even if the redirect URL is intercepted
 * the attacker can't exchange the code for tokens.
 */

/** RFC 7636 — verifier is 43-128 chars, base64url-encoded, unreserved chars only. */
const VERIFIER_LENGTH_BYTES = 32; // 32 bytes -> 43 base64url chars

/** RFC 7636 — state is at least 128 bits of entropy. */
const STATE_LENGTH_BYTES = 16; // 16 bytes -> 128 bits

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(VERIFIER_LENGTH_BYTES).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(STATE_LENGTH_BYTES).toString('base64url');
}
