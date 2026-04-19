import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/access-tokens';

type Database = DatabaseClient;

export class AccessTokensRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    createdBy: string;
    expiresAt?: Date;
  }): Promise<schema.AccessToken> {
    const [row] = await this.db
      .insert(schema.accessTokens)
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

  async findByHash(keyHash: string): Promise<schema.AccessToken | null> {
    const results = await this.db
      .select()
      .from(schema.accessTokens)
      .where(eq(schema.accessTokens.keyHash, keyHash))
      .limit(1);
    return results[0] ?? null;
  }

  async findById(id: string): Promise<schema.AccessToken | null> {
    const results = await this.db
      .select()
      .from(schema.accessTokens)
      .where(eq(schema.accessTokens.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  async list(): Promise<schema.AccessToken[]> {
    return this.db
      .select()
      .from(schema.accessTokens)
      .orderBy(desc(schema.accessTokens.createdAt));
  }

  async revoke(id: string): Promise<schema.AccessToken | null> {
    const results = await this.db
      .update(schema.accessTokens)
      .set({ revoked: 1 as unknown as boolean })
      .where(eq(schema.accessTokens.id, id))
      .returning();
    return results[0] ?? null;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(schema.accessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.accessTokens.id, id));
  }
}

export function createAccessTokensRepository(
  db: Database,
): AccessTokensRepository {
  return new AccessTokensRepository(db);
}
