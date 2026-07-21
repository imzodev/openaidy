import { describe, it, expect } from 'vitest';
import { signAssetToken, verifyAssetToken } from './asset-token';

const SECRET = 'test-secret-key-at-least-32-characters-long';

describe('asset-token', () => {
  it('verifies a freshly signed token', () => {
    const now = 1_000_000;
    const token = signAssetToken('addon-a', SECRET, 60_000, now);
    expect(verifyAssetToken(token, SECRET, { now: now + 1000 })).toBe(true);
  });

  it('binds the token to a specific addon when addonId is provided', () => {
    const now = 1_000_000;
    const token = signAssetToken('addon-a', SECRET, 60_000, now);
    expect(
      verifyAssetToken(token, SECRET, { addonId: 'addon-a', now: now + 1 }),
    ).toBe(true);
    expect(
      verifyAssetToken(token, SECRET, { addonId: 'addon-b', now: now + 1 }),
    ).toBe(false);
  });

  it('rejects an expired token', () => {
    const now = 1_000_000;
    const token = signAssetToken('addon-a', SECRET, 60_000, now);
    expect(verifyAssetToken(token, SECRET, { now: now + 60_001 })).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const now = 1_000_000;
    const token = signAssetToken('addon-a', SECRET, 60_000, now);
    expect(
      verifyAssetToken(token, 'a-different-secret-key-32-chars-min!', {
        now: now + 1,
      }),
    ).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifyAssetToken('', SECRET)).toBe(false);
    expect(verifyAssetToken('not-a-token', SECRET)).toBe(false);
    expect(verifyAssetToken('a.b.c', SECRET)).toBe(false);
    expect(verifyAssetToken('garbage.signature', SECRET)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const now = 1_000_000;
    const token = signAssetToken('addon-a', SECRET, 60_000, now);
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ addonId: 'addon-evil', exp: now + 60_000 }),
    ).toString('base64url');
    expect(verifyAssetToken(`${forged}.${sig}`, SECRET, { now: now + 1 })).toBe(
      false,
    );
  });
});
