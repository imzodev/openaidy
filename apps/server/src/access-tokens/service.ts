import { createHash, randomBytes } from 'node:crypto';
import type { AccessTokensStore } from '@openaidy/db';
import type { AccessTokenRecord } from '@openaidy/shared-types';

const KEY_PREFIX_LENGTH = 8;
const TOKEN_BYTES = 32;
const TOKEN_VERSION = 'oat'; // openaidy access token

function generateRawToken(): string {
  return `${TOKEN_VERSION}_${randomBytes(TOKEN_BYTES).toString('hex')}`;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toRecord(row: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  createdBy: string;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revoked: boolean | number;
  createdAt: Date | string;
}): AccessTokenRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: JSON.parse(row.scopes) as string[],
    createdBy: row.createdBy,
    expiresAt: toIso(row.expiresAt),
    lastUsedAt: toIso(row.lastUsedAt),
    revoked: Boolean(row.revoked),
    createdAt: toIso(row.createdAt)!,
  };
}

export class AccessTokenService {
  constructor(private readonly repo: AccessTokensStore) {}

  async create(input: {
    name: string;
    scopes: string[];
    createdBy: string;
    expiresAt?: Date;
  }): Promise<{ record: AccessTokenRecord; rawToken: string }> {
    const rawToken = generateRawToken();
    const keyHash = hashToken(rawToken);
    const keyPrefix = rawToken.slice(
      0,
      KEY_PREFIX_LENGTH + TOKEN_VERSION.length + 1,
    );

    const row = await this.repo.create({
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: input.scopes,
      createdBy: input.createdBy,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });

    return { record: toRecord(row), rawToken };
  }

  async list(): Promise<AccessTokenRecord[]> {
    const rows = await this.repo.list();
    return rows.map(toRecord);
  }

  async revoke(id: string): Promise<AccessTokenRecord | null> {
    const row = await this.repo.revoke(id);
    return row ? toRecord(row) : null;
  }

  async verifyToken(rawToken: string): Promise<AccessTokenRecord | null> {
    const keyHash = hashToken(rawToken);
    const row = await this.repo.findByHash(keyHash);

    if (!row) return null;
    if (row.revoked) return null;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

    await this.repo.touchLastUsed(row.id);
    return toRecord(row);
  }
}

export function createAccessTokenService(
  repo: AccessTokensStore,
): AccessTokenService {
  return new AccessTokenService(repo);
}
