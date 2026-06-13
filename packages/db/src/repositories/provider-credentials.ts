import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import {
  providerCredentials,
  type ProviderCredential,
} from '../schema/provider-credentials.js';

/**
 * Provider Credentials Repository
 *
 * Handles database operations for provider credentials.
 * Credentials are stored globally (not per-workspace) in this version.
 *
 * Every mutating method (`upsert`, `setError`, `delete`) fires the
 * optional `onChange` hook after the write commits, so any layer
 * holding a derived view of these rows (e.g. an in-memory credential
 * cache used by the OpenAI-compatible LLM adapter) can invalidate
 * itself without each call site having to remember to do so. New
 * OAuth providers that reuse this repository get cache invalidation
 * for free; they don't have to wire up their own notification path.
 */
export class ProviderCredentialsRepository {
  private readonly onChange: (providerId: string) => void;

  constructor(
    private readonly db: DatabaseClient,
    options: { onChange?: (providerId: string) => void } = {},
  ) {
    this.onChange = options.onChange ?? (() => {});
  }

  /**
   * Upsert credentials for a provider.
   * If credentials already exist, update them.
   */
  async upsert(
    providerId: string,
    authMethod: string,
    encryptedCredentials: string,
  ): Promise<ProviderCredential> {
    const existing = await this.findByProviderId(providerId);

    let result: ProviderCredential;
    if (existing) {
      // Update existing
      const updated = await this.db
        .update(providerCredentials)
        .set({
          authMethod,
          encryptedCredentials,
          status: 'connected',
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(providerCredentials.providerId, providerId))
        .returning();
      result = updated[0];
    } else {
      // Insert new
      // Note: createdAt/updatedAt are set explicitly here to avoid
      // the pgTable + SQLite `defaultNow()` → `now()` mismatch
      // (SQLite has no `now()` function; the typed insert would emit
      // `now()` and fail with "no such function: now").
      const now = new Date();
      const [inserted] = await this.db
        .insert(providerCredentials)
        .values({
          id: nanoid(),
          providerId,
          authMethod,
          encryptedCredentials,
          status: 'connected',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      result = inserted;
    }
    this.onChange(providerId);
    return result;
  }

  /**
   * Find credentials by provider ID
   */
  async findByProviderId(
    providerId: string,
  ): Promise<ProviderCredential | null> {
    const results = await this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.providerId, providerId))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * List all connected provider credentials
   */
  async listConnected(): Promise<ProviderCredential[]> {
    return this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.status, 'connected'))
      .orderBy(desc(providerCredentials.createdAt));
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    await this.db
      .update(providerCredentials)
      .set({
        lastUsedAt: new Date(),
      })
      .where(eq(providerCredentials.id, id));
  }

  /**
   * Set error status for credentials
   */
  async setError(providerId: string, errorMessage: string): Promise<void> {
    await this.db
      .update(providerCredentials)
      .set({
        status: 'error',
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.providerId, providerId));
    this.onChange(providerId);
  }

  /**
   * Delete credentials (disconnect)
   */
  async delete(providerId: string): Promise<boolean> {
    await this.db
      .update(providerCredentials)
      .set({
        status: 'disconnected',
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.providerId, providerId));
    this.onChange(providerId);
    return true;
  }

  /**
   * Get credential by ID
   */
  async findById(id: string): Promise<ProviderCredential | null> {
    const results = await this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, id))
      .limit(1);
    return results[0] ?? null;
  }
}
