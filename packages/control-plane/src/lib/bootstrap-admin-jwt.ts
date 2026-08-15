/**
 * Bootstrap Admin JWT Primitives
 *
 * HMAC-SHA256 + base64url sign/verify/decode for bootstrap-admin tokens.
 * Byte-for-byte compatible with `apps/server/src/websocket/middleware/auth.ts`
 * (`AuthMiddleware.generateToken` / `validateToken`) so a token minted here
 * (CLI) validates against the server, and vice versa. Covered by the
 * interop test in `../workflows/bootstrap-admin-ensure.test.ts`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type BootstrapAdminJwtPayload = {
  sub: string;
  type: 'access' | 'refresh' | 'pairing';
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
  clientType?: string;
  clientVersion?: string;
};

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

/**
 * Sign a bootstrap-admin JWT with HMAC-SHA256 + base64url encoding.
 */
export function signBootstrapAdminJwt(
  payload: BootstrapAdminJwtPayload,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify a JWT's signature and parse its payload.
 * Returns null on any tampering, malformed shape, or signature mismatch.
 */
export function verifyBootstrapAdminJwt(
  token: string,
  secret: string,
): BootstrapAdminJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) {
      return null;
    }
    const expectedSignature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const provided = Buffer.from(signature, 'utf-8');
    const expected = Buffer.from(expectedSignature, 'utf-8');
    if (provided.length !== expected.length) {
      return null;
    }
    if (!timingSafeEqual(provided, expected)) {
      return null;
    }
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number' ||
      !Array.isArray(decoded.scopes)
    ) {
      return null;
    }
    return decoded as unknown as BootstrapAdminJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Decode a JWT's payload WITHOUT verifying its signature.
 * Used only for read-only inspection where a forged-but-well-formed
 * token should still report its claimed status rather than requiring
 * the signing secret to be available.
 */
export function decodeBootstrapAdminJwtPayload(
  token: string,
): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}
