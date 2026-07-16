/**
 * At-rest encryption for inline MCP secrets (see issue #401).
 *
 * MCP server `env`/`headers` values are either a `${VAR}` reference (the
 * secret lives in the process environment, never touches disk) or an inline
 * value pasted straight into the form (e.g. `Authorization: Bearer ghp_xxx`).
 * Inline values are encrypted before they are written to `openaidy.json` so a
 * copy of the config file — a backup, a screen share, a git-tracked dotfile —
 * never exposes the raw credential.
 *
 * Reuses the same AES-256-GCM master key already used to encrypt provider
 * credentials ({@link getEncryptionService}) rather than introducing a
 * second key file: one key surface for operators to manage/rotate, and the
 * mechanism is already exercised in production.
 */

import { getEncryptionService } from '../lib/encryption';

/** Prefix marking a value as ciphertext produced by {@link encryptSecret}. */
const ENC_PREFIX = 'enc:v1:';

/**
 * Encrypt a plaintext inline secret for storage. Output format:
 * `enc:v1:<salt_hex>:<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
export function encryptSecret(plaintext: string): string {
  return ENC_PREFIX + getEncryptionService().encrypt(plaintext);
}

/**
 * Decrypt a value previously produced by {@link encryptSecret}.
 *
 * @throws {Error} if `value` is not an encrypted payload — check
 * {@link isEncryptedSecret} first when the value may be legacy plaintext.
 */
export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) {
    throw new Error(
      'Value is not an encrypted secret (missing enc:v1: prefix)',
    );
  }
  return getEncryptionService().decrypt(value.slice(ENC_PREFIX.length));
}

/** Whether `value` is ciphertext produced by {@link encryptSecret}. */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/**
 * Ensure the encryption key is generated/loaded, without encrypting anything.
 * Call this eagerly (e.g. CLI startup) to fail fast — and to write the key
 * file up front — before any secret needs encrypting.
 */
export function ensureEncryptionKey(): void {
  getEncryptionService();
}
