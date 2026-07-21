import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from './env';
import { createLogger } from './logger';

const log = createLogger('encryption');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

/**
 * Derive a fixed-length key from master password using SHA-256
 */
function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  const hash = createHash('sha256');
  hash.update(masterKey);
  hash.update(salt);
  return hash.digest().slice(0, KEY_LENGTH);
}

/**
 * Encryption service for secure credential storage.
 * Uses AES-256-GCM with a master key derived from environment.
 */
export class EncryptionService {
  private masterKey: Buffer;

  constructor(masterKey: string) {
    if (!masterKey || masterKey.length < 32) {
      throw new Error('Master key must be at least 32 characters');
    }
    this.masterKey = Buffer.from(masterKey, 'utf8');
  }

  /**
   * Encrypt plaintext for storage
   */
  encrypt(plaintext: string): string {
    const salt = randomBytes(16);
    const key = deriveKey(this.masterKey, salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: salt:iv:authTag:encrypted (all hex)
    return [
      salt.toString('hex'),
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
  }

  /**
   * Decrypt ciphertext from storage
   */
  decrypt(ciphertext: string): string {
    const [saltHex, ivHex, authTagHex, encryptedHex] = ciphertext.split(':');

    if (!saltHex || !ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid ciphertext format');
    }

    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const key = deriveKey(this.masterKey, salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }
}

/**
 * Resolve the master key used to encrypt credentials at rest.
 *
 * Resolution order (zero-config but never a shared hardcoded secret):
 *   1. CREDENTIALS_MASTER_KEY env var — explicit operator override for
 *      containerized/rotated/shared-key deployments.
 *   2. A unique random key persisted per install under OPENAIDY_HOME. On
 *      first run it is generated and written (0600) next to the data it
 *      protects, so the app works out of the box with no configuration.
 *   3. Tests use an ephemeral in-memory key and never touch disk.
 */
function resolveMasterKey(): string {
  const override = env.CREDENTIALS_MASTER_KEY;
  if (override) {
    return override;
  }

  if (env.NODE_ENV === 'test') {
    return randomBytes(KEY_LENGTH).toString('hex');
  }

  const keyPath = resolve(env.OPENAIDY_HOME, 'credentials/master.key');

  if (existsSync(keyPath)) {
    const existing = readFileSync(keyPath, 'utf8').trim();
    if (existing.length >= 32) {
      return existing;
    }
    log.warn(
      `Master key file at ${keyPath} is malformed; generating a new one`,
    );
  }

  const generated = randomBytes(KEY_LENGTH).toString('hex');
  mkdirSync(dirname(keyPath), { recursive: true });
  // Owner read/write only — best effort (mode is largely ignored on Windows).
  writeFileSync(keyPath, generated, { mode: 0o600 });
  log.info(`Generated a new credential-encryption key at ${keyPath}`);
  return generated;
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    encryptionService = new EncryptionService(resolveMasterKey());
  }
  return encryptionService;
}
