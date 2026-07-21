import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  ensureEncryptionKey,
} from './secret-crypto';

describe('secret-crypto', () => {
  it('round-trips a plaintext secret through encrypt/decrypt', () => {
    const encrypted = encryptSecret('ghp_realLongLivedToken1234567890');
    expect(decryptSecret(encrypted)).toBe('ghp_realLongLivedToken1234567890');
  });

  it('prefixes ciphertext with enc:v1: and isEncryptedSecret recognizes it', () => {
    const encrypted = encryptSecret('some-secret');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(isEncryptedSecret(encrypted)).toBe(true);
  });

  it('does not treat plaintext as encrypted', () => {
    expect(isEncryptedSecret('Bearer ghp_plaintext')).toBe(false);
    expect(isEncryptedSecret('${SOME_VAR}')).toBe(false);
  });

  it('produces different ciphertext for the same plaintext each time (random IV/salt)', () => {
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-secret');
    expect(decryptSecret(b)).toBe('same-secret');
  });

  it('throws when decrypting a value without the enc:v1: prefix', () => {
    expect(() => decryptSecret('not-encrypted')).toThrow(
      /not an encrypted secret/,
    );
  });

  it('throws when decrypting a value that has the prefix but no ciphertext body', () => {
    // Prefix only — must surface as a clear error rather than a silent
    // crash inside the underlying crypto APIs.
    expect(() => decryptSecret('enc:v1:')).toThrow();
  });

  it('throws when decrypting ciphertext whose auth tag was tampered with', () => {
    // GCM auth tags are checked on decryption — any byte flip must throw,
    // never silently return garbage.
    const encrypted = encryptSecret('ghp_realLongLivedToken1234567890');
    // Flip the last hex char of the auth tag (the segment immediately
    // before the ciphertext segment). The string is salt:iv:authTag:ct.
    const withoutPrefix = encrypted.slice('enc:v1:'.length);
    const parts = withoutPrefix.split(':');
    const tag = parts[2]!;
    const flipped = tag.slice(0, -1) + (tag.slice(-1) === '0' ? '1' : '0');
    parts[2] = flipped;
    const tampered = 'enc:v1:' + parts.join(':');
    expect(tampered).not.toBe(encrypted);
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws when decrypting truncated ciphertext', () => {
    const encrypted = encryptSecret('ghp_realLongLivedToken1234567890');
    // Drop the last 10 hex chars (40 bits) of the ciphertext segment.
    const withoutPrefix = encrypted.slice('enc:v1:'.length);
    const parts = withoutPrefix.split(':');
    parts[3] = parts[3]!.slice(0, -10);
    const truncated = 'enc:v1:' + parts.join(':');
    expect(() => decryptSecret(truncated)).toThrow();
  });

  it('encrypts unicode round-trip', () => {
    const encrypted = encryptSecret('🔐-tëst-値-секрет');
    expect(decryptSecret(encrypted)).toBe('🔐-tëst-値-секрет');
  });

  it('encrypts a long secret round-trip (1 MiB payload)', () => {
    const plaintext = 'A'.repeat(1024 * 1024);
    const encrypted = encryptSecret(plaintext);
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('ensureEncryptionKey does not throw', () => {
    expect(() => ensureEncryptionKey()).not.toThrow();
  });
});
