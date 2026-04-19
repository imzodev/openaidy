import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/api-keys';

type Database = DatabaseClient;

export class ApiKeysRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    createdBy: string;
    expiresAt?: Date;
  }): Promise<schema.ApiKey> {
    const [row] = await this.db
      .insert(schema.apiKeys)
      .values({
        id: nanoid(),
        name: input.name,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        scopes: JSON.stringify(input.scopes),
        createdBy: input.createdBy,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        revoked: 0 as unknown as boolean,
        createdAt: new Date(),
      })
      .returning();
    return row!;
  }

  async findByHash(keyHash: string): Promise<schema.ApiKey | null> {
    const results = await this.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, keyHash))
      .limit(1);
    return results[0] ?? null;
  }

  async findById(id: string): Promise<schema.ApiKey | null> {
    const results = await this.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  async list(): Promise<schema.ApiKey[]> {
    return this.db
      .select()
      .from(schema.apiKeys)
      .orderBy(desc(schema.apiKeys.createdAt));
  }

  async revoke(id: string): Promise<schema.ApiKey | null> {
    const results = await this.db
      .update(schema.apiKeys)
      .set({ revoked: 1 as unknown as boolean })
      .where(eq(schema.apiKeys.id, id))
      .returning();
    return results[0] ?? null;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, id));
  }
}

export function createApiKeysRepository(db: Database): ApiKeysRepository {
  return new ApiKeysRepository(db);
}
