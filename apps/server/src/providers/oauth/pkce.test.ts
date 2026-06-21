import { describe, it, expect } from 'vitest';
import { generatePkce, generateState } from './pkce';

describe('PKCE helpers', () => {
  it('generates a verifier and challenge of expected shapes', () => {
    const { verifier, challenge } = generatePkce();
    // Base64url-encoded 32 bytes → 43 chars
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // SHA-256 base64url → 43 chars
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('produces a verifiable S256 challenge', async () => {
    const { createHash } = await import('node:crypto');
    const { verifier, challenge } = generatePkce();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('generates unique verifiers on each call', () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('generates unique state values on each call', () => {
    expect(generateState()).not.toBe(generateState());
  });

  it('generates state of expected length (16 bytes → ~22 base64url chars)', () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
