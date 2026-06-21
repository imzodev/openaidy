import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Provider credentials table
 *
 * Stores encrypted credentials for provider connections.
 * Credentials are stored globally (not per-workspace) in this version.
 */
export const providerCredentials = pgTable('provider_credentials', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  authMethod: text('auth_method').notNull(), // 'api_key', 'oauth', 'device_code'
  encryptedCredentials: text('encrypted_credentials').notNull(),
  status: text('status').notNull().default('connected'), // 'connected', 'error', 'disconnected'
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type NewProviderCredential = typeof providerCredentials.$inferInsert;
