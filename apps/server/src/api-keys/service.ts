import { createHash, randomBytes } from 'node:crypto';
import type { ApiKeysStore } from '@openaidy/db';
import type { ApiKeyRecord } from '@openaidy/shared-types';

const KEY_PREFIX_LENGTH = 8;
const KEY_BYTES = 32;
const KEY_VERSION = 'oak'; // openaidy key

function generateRawKey(): string {
  return `${KEY_VERSION}_${randomBytes(KEY_BYTES).toString('hex')}`;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
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
}): ApiKeyRecord {
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

export class ApiKeyService {
  constructor(private readonly repo: ApiKeysStore) {}

  async create(input: {
    name: string;
    scopes: string[];
    createdBy: string;
    expiresAt?: Date;
  }): Promise<{ record: ApiKeyRecord; rawKey: string }> {
    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(
      0,
      KEY_PREFIX_LENGTH + KEY_VERSION.length + 1,
    );

    const row = await this.repo.create({
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: input.scopes,
      createdBy: input.createdBy,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });

    return { record: toRecord(row), rawKey };
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await this.repo.list();
    return rows.map(toRecord);
  }

  async revoke(id: string): Promise<ApiKeyRecord | null> {
    const row = await this.repo.revoke(id);
    return row ? toRecord(row) : null;
  }

  async verifyKey(rawKey: string): Promise<ApiKeyRecord | null> {
    const keyHash = hashKey(rawKey);
    const row = await this.repo.findByHash(keyHash);

    if (!row) return null;
    if (row.revoked) return null;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

    await this.repo.touchLastUsed(row.id);
    return toRecord(row);
  }
}

export function createApiKeyService(repo: ApiKeysStore): ApiKeyService {
  return new ApiKeyService(repo);
}
