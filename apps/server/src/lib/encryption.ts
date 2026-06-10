import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';

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

// Singleton instance
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    let masterKey = process.env.CREDENTIALS_MASTER_KEY;
    if (!masterKey) {
      // Fallback for development - use a default key (NOT SECURE FOR PRODUCTION)
      console.warn(
        'WARNING: CREDENTIALS_MASTER_KEY not set, using development key',
      );
      masterKey = 'dev-master-key-do-not-use-in-production!!';
    }
    encryptionService = new EncryptionService(masterKey);
  }
  return encryptionService;
}
