/**
 * Marketplace Database Schema
 *
 * Comprehensive data models for addon marketplace operations including
 * published addons, versions, reviews, categories, and analytics.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  decimal,
  boolean,
  serial,
  varchar,
  index,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Marketplace addon status enum
 */
export const marketplaceStatusEnum = [
  'draft',
  'pending_review',
  'published',
  'rejected',
  'deprecated',
  'deleted',
] as const;
export type MarketplaceStatus = (typeof marketplaceStatusEnum)[number];

/**
 * Review rating enum
 */
export const ratingEnum = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof ratingEnum)[number];

/**
 * Marketplace addons table
 *
 * Stores published addons in the marketplace with full metadata.
 */
export const marketplaceAddons = pgTable(
  'marketplace_addons',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    shortDescription: text('short_description').notNull(),
    authorId: text('author_id').notNull(),
    authorName: text('author_name').notNull(),
    authorEmail: text('author_email').notNull(),
    website: text('website'),
    repository: text('repository'),
    license: text('license').notNull().default('MIT'),
    status: text('status').notNull().default('draft'),
    categoryId: integer('category_id'),
    tags: jsonb('tags').notNull().default([]),
    iconUrl: text('icon_url'),
    bannerUrl: text('banner_url'),
    screenshots: jsonb('screenshots').notNull().default([]),
    manifest: jsonb('manifest').notNull(),
    currentVersion: text('current_version').notNull(),
    downloads: integer('downloads').notNull().default(0),
    rating: decimal('rating', { precision: 3, scale: 2 })
      .notNull()
      .default('0.00'),
    reviewCount: integer('review_count').notNull().default(0),
    featured: boolean('featured').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    statusIdx: index('marketplace_addons_status_idx').on(table.status),
    authorIdx: index('marketplace_addons_author_idx').on(table.authorId),
    categoryIdx: index('marketplace_addons_category_idx').on(table.categoryId),
    downloadsIdx: index('marketplace_addons_downloads_idx').on(table.downloads),
    ratingIdx: index('marketplace_addons_rating_idx').on(table.rating),
  }),
);

export type MarketplaceAddon = typeof marketplaceAddons.$inferSelect;
export type NewMarketplaceAddon = typeof marketplaceAddons.$inferInsert;

/**
 * Addon versions table
 *
 * Manages version history for marketplace addons.
 */
export const addonVersions = pgTable(
  'addon_versions',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id')
      .notNull()
      .references(() => marketplaceAddons.addonId, { onDelete: 'cascade' }),
    version: varchar('version', { length: 50 }).notNull(),
    changelog: text('changelog').notNull(),
    manifest: jsonb('manifest').notNull(),
    minOpenaidyVersion: text('min_openaidy_version').notNull(),
    maxOpenaidyVersion: text('max_openaidy_version').notNull(),
    downloadUrl: text('download_url').notNull(),
    fileSize: integer('file_size').notNull(),
    checksum: text('checksum').notNull(),
    releaseNotes: text('release_notes'),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    addonVersionIdx: index('addon_versions_addon_version_idx').on(
      table.addonId,
      table.version,
    ),
    addonIdIdx: index('addon_versions_addon_id_idx').on(table.addonId),
  }),
);

export type AddonVersion = typeof addonVersions.$inferSelect;
export type NewAddonVersion = typeof addonVersions.$inferInsert;

/**
 * Addon reviews table
 *
 * User reviews and ratings for marketplace addons.
 */
export const addonReviews = pgTable(
  'addon_reviews',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id')
      .notNull()
      .references(() => marketplaceAddons.addonId, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    rating: integer('rating').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    pros: jsonb('pros').notNull().default([]),
    cons: jsonb('cons').notNull().default([]),
    verified: boolean('verified').notNull().default(false),
    helpful: integer('helpful').notNull().default(0),
    notHelpful: integer('not_helpful').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    addonIdIdx: index('addon_reviews_addon_id_idx').on(table.addonId),
    userIdIdx: index('addon_reviews_user_id_idx').on(table.userId),
    ratingIdx: index('addon_reviews_rating_idx').on(table.rating),
  }),
);

export type AddonReview = typeof addonReviews.$inferSelect;
export type NewAddonReview = typeof addonReviews.$inferInsert;

/**
 * Addon categories table
 *
 * Hierarchical category structure for addon organization.
 */
export const addonCategories = pgTable(
  'addon_categories',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    icon: text('icon').notNull(),
    parentId: integer('parent_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    parentIdx: index('addon_categories_parent_idx').on(table.parentId),
    slugIdx: index('addon_categories_slug_idx').on(table.slug),
  }),
);

export type AddonCategory = typeof addonCategories.$inferSelect;
export type NewAddonCategory = typeof addonCategories.$inferInsert;

/**
 * Addon downloads table
 *
 * Detailed download tracking and analytics.
 */
export const addonDownloads = pgTable(
  'addon_downloads',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id')
      .notNull()
      .references(() => marketplaceAddons.addonId, { onDelete: 'cascade' }),
    version: varchar('version', { length: 50 }).notNull(),
    userId: text('user_id'),
    instanceId: text('instance_id'),
    source: text('source').notNull().default('direct'),
    country: varchar('country', { length: 2 }),
    userAgent: text('user_agent'),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    addonIdIdx: index('addon_downloads_addon_id_idx').on(table.addonId),
    downloadedAtIdx: index('addon_downloads_downloaded_at_idx').on(
      table.downloadedAt,
    ),
  }),
);

export type AddonDownload = typeof addonDownloads.$inferSelect;
export type NewAddonDownload = typeof addonDownloads.$inferInsert;

/**
 * Addon favorites table
 *
 * User favorites for quick access.
 */
export const addonFavorites = pgTable(
  'addon_favorites',
  {
    id: text('id').primaryKey(),
    addonId: text('addon_id')
      .notNull()
      .references(() => marketplaceAddons.addonId, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    addonUserIdx: unique('addon_favorites_addon_user_idx').on(
      table.addonId,
      table.userId,
    ),
    userIdIdx: index('addon_favorites_user_id_idx').on(table.userId),
  }),
);

export type AddonFavorite = typeof addonFavorites.$inferSelect;
export type NewAddonFavorite = typeof addonFavorites.$inferInsert;

/**
 * Addon collections table
 *
 * Curated addon collections by users or staff.
 */
export const addonCollections = pgTable(
  'addon_collections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug').notNull().unique(),
    userId: text('user_id'),
    isPublic: boolean('is_public').notNull().default(true),
    addonCount: integer('addon_count').notNull().default(0),
    featured: boolean('featured').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugIdx: index('addon_collections_slug_idx').on(table.slug),
    userIdIdx: index('addon_collections_user_id_idx').on(table.userId),
  }),
);

export type AddonCollection = typeof addonCollections.$inferSelect;
export type NewAddonCollection = typeof addonCollections.$inferInsert;

/**
 * Collection addons junction table
 */
export const collectionAddons = pgTable(
  'collection_addons',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => addonCollections.id, { onDelete: 'cascade' }),
    addonId: text('addon_id')
      .notNull()
      .references(() => marketplaceAddons.addonId, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    collectionAddonIdx: unique('collection_addons_collection_addon_idx').on(
      table.collectionId,
      table.addonId,
    ),
  }),
);

export type CollectionAddon = typeof collectionAddons.$inferSelect;
export type NewCollectionAddon = typeof collectionAddons.$inferInsert;
