import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import { mcpOAuthCredentials } from '../schema/mcp-oauth-credentials';

/**
 * Repository for MCP server OAuth credentials.
 *
 * Stores an opaque (already encrypted) string per server — callers own the
 * credential shape and its encryption, so this layer never sees plaintext.
 */
export class McpOAuthCredentialsRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Encrypted credentials for a server, or null if none are stored. */
  async get(serverId: string): Promise<string | null> {
    const results = await this.db
      .select()
      .from(mcpOAuthCredentials)
      .where(eq(mcpOAuthCredentials.serverId, serverId))
      .limit(1);
    return results[0]?.encryptedData ?? null;
  }

  /** Insert or replace the encrypted credentials for a server. */
  async put(serverId: string, encryptedData: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(mcpOAuthCredentials)
      .values({ serverId, encryptedData, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: mcpOAuthCredentials.serverId,
        set: { encryptedData, updatedAt: now },
      });
  }

  /** Remove a server's credentials (sign-out, or server deleted). */
  async delete(serverId: string): Promise<void> {
    await this.db
      .delete(mcpOAuthCredentials)
      .where(eq(mcpOAuthCredentials.serverId, serverId));
  }
}
