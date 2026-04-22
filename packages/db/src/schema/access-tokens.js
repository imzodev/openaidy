import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
/**
 * Access tokens table
 *
 * Stores hashed access tokens for user/tool authentication.
 * The raw token is shown once at creation and never stored.
 */
export const accessTokens = pgTable('access_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes').notNull(),
  createdBy: text('created_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
