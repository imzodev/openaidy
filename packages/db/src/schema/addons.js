import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  unique,
  index,
} from 'drizzle-orm/pg-core';
/**
 * Addon status enum
 */
export const addonStatusEnum = ['installed', 'enabled', 'disabled', 'error'];
/**
 * Addons table
 *
 * Main addon registry storing addon metadata, status, and configuration.
 */
export const addons = pgTable(
  'addons',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id').notNull().unique(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    manifest: jsonb('manifest').notNull(),
    status: text('status').notNull().default('installed'),
    permissions: jsonb('permissions').notNull().default([]),
    config: jsonb('config').notNull().default({}),
    installedAt: timestamp('installed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    installedBy: text('installed_by').notNull(),
  },
  (table) => ({
    statusIdx: index('addons_status_idx').on(table.status),
    addonIdIdx: index('addons_addon_id_idx').on(table.addonId),
  }),
);
/**
 * Addon permission changes table
 *
 * Audit log for tracking permission changes to addons.
 */
export const addonPermissionChanges = pgTable(
  'addon_permission_changes',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id')
      .notNull()
      .references(() => addons.id, { onDelete: 'cascade' }),
    changedBy: text('changed_by').notNull(),
    oldPermissions: jsonb('old_permissions'),
    newPermissions: jsonb('new_permissions'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    addonIdIdx: index('addon_permission_changes_addon_id_idx').on(
      table.addonId,
    ),
    createdAtIdx: index('addon_permission_changes_created_at_idx').on(
      table.createdAt,
    ),
  }),
);
/**
 * Addon usage metrics table
 *
 * Tracks daily usage metrics per addon/endpoint for analytics and rate limiting.
 */
export const addonUsage = pgTable(
  'addon_usage',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id')
      .notNull()
      .references(() => addons.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    lastUsed: timestamp('last_used', { withTimezone: true }),
    date: text('date').notNull(),
  },
  (table) => ({
    uniqueAddonEndpointDate: unique('addon_usage_addon_endpoint_date_idx').on(
      table.addonId,
      table.endpoint,
      table.date,
    ),
    addonIdIdx: index('addon_usage_addon_id_idx').on(table.addonId),
    dateIdx: index('addon_usage_date_idx').on(table.date),
  }),
);
