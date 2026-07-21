import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, addon-scoped tokens that authorize loading an addon's static
 * assets (HTML/JS/CSS + the shared SDK) from the sandboxed iframe.
 *
 * The iframe runs at an opaque origin and loads subresources in credential-less
 * CORS mode, so neither a bearer header nor a cookie can ride along. Instead the
 * web client mints one of these tokens via an authenticated endpoint and puts it
 * on the asset URLs (`?at=`); the server propagates it to every rewritten
 * subresource URL. Tokens are HMAC-signed with the server's JWT secret, carry an
 * expiry, and are bound to a single addon id.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`
 */

type AssetTokenPayload = { addonId: string; exp: number };

function sign(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/**
 * Create an asset token for `addonId` valid for `ttlMs` milliseconds.
 * `now` is injectable for deterministic testing.
 */
export function signAssetToken(
  addonId: string,
  secret: string,
  ttlMs: number,
  now: number = Date.now(),
): string {
  const payload: AssetTokenPayload = { addonId, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret).toString('base64url')}`;
}

/**
 * Verify an asset token's signature and expiry. When `addonId` is provided, the
 * token must also be bound to that addon (the shared SDK route omits it).
 */
export function verifyAssetToken(
  token: string,
  secret: string,
  opts: { addonId?: string; now?: number } = {},
): boolean {
  const now = opts.now ?? Date.now();
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [body, providedSig] = parts;
  if (!body || !providedSig) return false;

  const expected = sign(body, secret);
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSig, 'base64url');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(provided, expected)) return false;

  let payload: AssetTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as AssetTokenPayload;
  } catch {
    return false;
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) return false;
  if (opts.addonId !== undefined && payload.addonId !== opts.addonId) {
    return false;
  }
  return true;
}
