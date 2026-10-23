import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * MCP OAuth credentials table
 *
 * One row per OAuth-enabled MCP server, holding everything the MCP SDK's
 * OAuth client needs to persist between connections: the dynamically
 * registered client, the access/refresh tokens, the in-flight PKCE verifier,
 * and cached discovery metadata. Stored as a single encrypted JSON blob —
 * the server layer owns the shape and the encryption, this table just keeps
 * the ciphertext.
 */
export const mcpOAuthCredentials = pgTable('mcp_oauth_credentials', {
  /** MCP server id (matches `mcpServers[].id` in the app config). */
  serverId: text('server_id').primaryKey(),

  /** AES-256-GCM ciphertext of the JSON credentials blob. */
  encryptedData: text('encrypted_data').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type McpOAuthCredential = typeof mcpOAuthCredentials.$inferSelect;
export type NewMcpOAuthCredential = typeof mcpOAuthCredentials.$inferInsert;
