# Phase 5: Advanced Features - Addons Implementation

## Overview

Phase 5 introduces advanced features that transform the addon system into a full-featured ecosystem. This phase includes addon marketplace/discovery, version management, dependency resolution, analytics dashboard, and monetization support. These features enable OpenAidy to scale its addon ecosystem and provide enterprise-grade addon management.

## Objectives

- Create addon marketplace with discovery and search capabilities
- Implement version management and automatic update system
- Add addon dependency resolution and compatibility checking
- Build analytics dashboard for addon usage and performance
- Implement addon monetization and licensing support
- Create distributed addon registry for scalability

## Implementation Tasks

### 1. Addon Marketplace

#### 1.1 Create Marketplace Database Schema

**File: `packages/db/src/schema/marketplace.ts`**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  decimal,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';

/**
 * Published addons available in marketplace
 */
export const marketplaceAddons = pgTable(
  'marketplace_addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addonId: varchar('addon_id', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    shortDescription: varchar('short_description', { length: 500 }),
    version: varchar('version', { length: 50 }).notNull(),
    author: varchar('author', { length: 255 }).notNull(),
    authorEmail: varchar('author_email', { length: 255 }),
    authorUrl: varchar('author_url', { length: 500 }),
    repository: varchar('repository', { length: 500 }),
    homepage: varchar('homepage', { length: 500 }),
    license: varchar('license', { length: 100 }),
    manifest: jsonb('manifest').notNull(),
    packageUrl: varchar('package_url', { length: 1000 }), // CDN URL
    packageSize: integer('package_size'), // Size in bytes
    packageHash: varchar('package_hash', { length: 64 }), // SHA-256 hash
    downloadCount: integer('download_count').default(0).notNull(),
    rating: decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
    ratingCount: integer('rating_count').default(0).notNull(),
    featured: boolean('featured').default(false).notNull(),
    verified: boolean('verified').default(false).notNull(),
    published: boolean('published').default(true).notNull(),
    publishedAt: timestamp('published_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    tags: jsonb('tags').notNull().default('[]'), // Array of strings
    category: varchar('category', { length: 100 }),
    price: decimal('price', { precision: 10, scale: 2 }).default('0.00'), // For paid addons
    currency: varchar('currency', { length: 3 }).default('USD'),
  },
  (table) => ({
    nameIdx: index('idx_marketplace_addons_name').on(table.name),
    authorIdx: index('idx_marketplace_addons_author').on(table.author),
    categoryIdx: index('idx_marketplace_addons_category').on(table.category),
    featuredIdx: index('idx_marketplace_addons_featured').on(table.featured),
    publishedIdx: index('idx_marketplace_addons_published').on(table.published),
    downloadCountIdx: index('idx_marketplace_addons_download_count').on(
      table.downloadCount,
    ),
    ratingIdx: index('idx_marketplace_addons_rating').on(table.rating),
  }),
);

/**
 * Addon versions for version management
 */
export const addonVersions = pgTable(
  'addon_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplaceAddonId: uuid('marketplace_addon_id').references(
      () => marketplaceAddons.id,
      { onDelete: 'cascade' },
    ),
    version: varchar('version', { length: 50 }).notNull(),
    changelog: text('changelog'),
    packageUrl: varchar('package_url', { length: 1000 }),
    packageSize: integer('package_size'),
    packageHash: varchar('package_hash', { length: 64 }),
    downloadCount: integer('download_count').default(0).notNull(),
    isLatest: boolean('is_latest').default(false).notNull(),
    isPrerelease: boolean('is_prerelease').default(false).notNull(),
    minOpenaidyVersion: varchar('min_openaidy_version', { length: 50 }),
    maxOpenaidyVersion: varchar('max_openaidy_version', { length: 50 }),
    dependencies: jsonb('dependencies').notNull().default('{}'), // Addon dependencies
    publishedAt: timestamp('published_at').defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: index('idx_addon_versions_version').on(table.version),
    latestIdx: index('idx_addon_versions_is_latest').on(table.isLatest),
    prereleaseIdx: index('idx_addon_versions_is_prerelease').on(
      table.isPrerelease,
    ),
  }),
);

/**
 * Addon reviews and ratings
 */
export const addonReviews = pgTable(
  'addon_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplaceAddonId: uuid('marketplace_addon_id').references(
      () => marketplaceAddons.id,
      { onDelete: 'cascade' },
    ),
    userId: varchar('user_id', { length: 255 }).notNull(),
    version: varchar('version', { length: 50 }),
    rating: integer('rating').notNull(), // 1-5 stars
    title: varchar('title', { length: 255 }),
    content: text('content'),
    helpful: integer('helpful').default(0).notNull(),
    verified: boolean('verified').default(false).notNull(), // Verified purchase/install
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    addonIdx: index('idx_addon_reviews_marketplace_addon_id').on(
      table.marketplaceAddonId,
    ),
    userIdx: index('idx_addon_reviews_user_id').on(table.userId),
    ratingIdx: index('idx_addon_reviews_rating').on(table.rating),
  }),
);

/**
 * Addon categories
 */
export const addonCategories = pgTable(
  'addon_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),
    icon: varchar('icon', { length: 100 }),
    parentId: uuid('parent_id').references(() => addonCategories.id),
    order: integer('order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
  },
  (table) => ({
    slugIdx: index('idx_addon_categories_slug').on(table.slug),
    parentIdx: index('idx_addon_categories_parent_id').on(table.parentId),
    activeIdx: index('idx_addon_categories_active').on(table.active),
  }),
);

/**
 * Addon download analytics
 */
export const addonDownloads = pgTable(
  'addon_downloads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketplaceAddonId: uuid('marketplace_addon_id').references(
      () => marketplaceAddons.id,
      { onDelete: 'cascade' },
    ),
    version: varchar('version', { length: 50 }),
    userId: varchar('user_id', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 45 }), // IPv6 compatible
    userAgent: text('user_agent'),
    referer: varchar('referer', { length: 1000 }),
    source: varchar('source', { length: 100 }), // marketplace, direct, api, etc.
    downloadedAt: timestamp('downloaded_at').defaultNow().notNull(),
  },
  (table) => ({
    addonIdx: index('idx_addon_downloads_marketplace_addon_id').on(
      table.marketplaceAddonId,
    ),
    dateIdx: index('idx_addon_downloads_downloaded_at').on(table.downloadedAt),
    versionIdx: index('idx_addon_downloads_version').on(table.version),
  }),
);

// Types
export type MarketplaceAddon = typeof marketplaceAddons.$inferSelect;
export type NewMarketplaceAddon = typeof marketplaceAddons.$inferInsert;
export type AddonVersion = typeof addonVersions.$inferSelect;
export type NewAddonVersion = typeof addonVersions.$inferInsert;
export type AddonReview = typeof addonReviews.$inferSelect;
export type NewAddonReview = typeof addonReviews.$inferInsert;
export type AddonCategory = typeof addonCategories.$inferSelect;
export type NewAddonCategory = typeof addonCategories.$inferInsert;
export type AddonDownload = typeof addonDownloads.$inferSelect;
export type NewAddonDownload = typeof addonDownloads.$inferInsert;
```

#### 1.2 Create Marketplace Service

**File: `apps/server/src/marketplace/service.ts`**

```typescript
import type {
  MarketplaceAddon,
  AddonVersion,
  AddonReview,
  AddonCategory,
  AddonDownload,
  NewMarketplaceAddon,
  NewAddonVersion,
} from '@openaidy/db';
import type { Database } from '@openaidy/db/client';
import { eq, and, desc, asc, ilike, sql, inArray } from 'drizzle-orm';
import {
  marketplaceAddons,
  addonVersions,
  addonReviews,
  addonCategories,
  addonDownloads,
} from '@openaidy/db/schema/marketplace';

export interface MarketplaceServiceOptions {
  db: Database;
  storageService: StorageService;
}

export interface SearchOptions {
  query?: string;
  category?: string;
  tags?: string[];
  author?: string;
  featured?: boolean;
  verified?: boolean;
  free?: boolean;
  minRating?: number;
  sortBy?: 'name' | 'rating' | 'downloads' | 'updated' | 'created';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PublishAddonRequest {
  manifest: any;
  packageBuffer: Buffer;
  changelog?: string;
  isPrerelease?: boolean;
}

export class MarketplaceService {
  constructor(private options: MarketplaceServiceOptions) {}

  /**
   * Search and list addons in marketplace
   */
  async searchAddons(searchOptions: SearchOptions = {}): Promise<{
    addons: MarketplaceAddon[];
    total: number;
    categories: AddonCategory[];
  }> {
    const {
      query,
      category,
      tags,
      author,
      featured,
      verified,
      free,
      minRating,
      sortBy = 'updated',
      sortOrder = 'desc',
      limit = 20,
      offset = 0,
    } = searchOptions;

    // Build query conditions
    const conditions = [eq(marketplaceAddons.published, true)];

    if (category) {
      conditions.push(eq(marketplaceAddons.category, category));
    }

    if (featured !== undefined) {
      conditions.push(eq(marketplaceAddons.featured, featured));
    }

    if (verified !== undefined) {
      conditions.push(eq(marketplaceAddons.verified, verified));
    }

    if (free !== undefined) {
      if (free) {
        conditions.push(eq(marketplaceAddons.price, '0.00'));
      } else {
        conditions.push(sql`${marketplaceAddons.price} > 0`);
      }
    }

    if (minRating !== undefined) {
      conditions.push(sql`${marketplaceAddons.rating} >= ${minRating}`);
    }

    if (author) {
      conditions.push(ilike(marketplaceAddons.author, `%${author}%`));
    }

    if (query) {
      conditions.push(
        sql`(${marketplaceAddons.name} ILIKE ${'%' + query + '%'} OR ${marketplaceAddons.description} ILIKE ${'%' + query + '%'})`,
      );
    }

    if (tags && tags.length > 0) {
      conditions.push(sql`${marketplaceAddons.tags} && ${tags}`);
    }

    // Build order by
    let orderBy;
    switch (sortBy) {
      case 'name':
        orderBy =
          sortOrder === 'desc'
            ? desc(marketplaceAddons.name)
            : asc(marketplaceAddons.name);
        break;
      case 'rating':
        orderBy =
          sortOrder === 'desc'
            ? desc(marketplaceAddons.rating)
            : asc(marketplaceAddons.rating);
        break;
      case 'downloads':
        orderBy =
          sortOrder === 'desc'
            ? desc(marketplaceAddons.downloadCount)
            : asc(marketplaceAddons.downloadCount);
        break;
      case 'created':
        orderBy =
          sortOrder === 'desc'
            ? desc(marketplaceAddons.publishedAt)
            : asc(marketplaceAddons.publishedAt);
        break;
      case 'updated':
      default:
        orderBy =
          sortOrder === 'desc'
            ? desc(marketplaceAddons.updatedAt)
            : asc(marketplaceAddons.updatedAt);
        break;
    }

    // Execute query
    const [addonsResult, totalCountResult, categoriesResult] =
      await Promise.all([
        this.options.db
          .select()
          .from(marketplaceAddons)
          .where(and(...conditions))
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset),

        this.options.db
          .select({ count: sql<number>`count(*)` })
          .from(marketplaceAddons)
          .where(and(...conditions)),

        this.options.db
          .select()
          .from(addonCategories)
          .where(eq(addonCategories.active, true))
          .orderBy(asc(addonCategories.order)),
      ]);

    return {
      addons: addonsResult,
      total: totalCountResult[0]?.count || 0,
      categories: categoriesResult,
    };
  }

  /**
   * Get addon details with versions and reviews
   */
  async getAddonDetails(addonId: string): Promise<{
    addon: MarketplaceAddon | null;
    versions: AddonVersion[];
    reviews: AddonReview[];
    relatedAddons: MarketplaceAddon[];
  }> {
    const [addonResult, versionsResult, reviewsResult, relatedResult] =
      await Promise.all([
        this.options.db
          .select()
          .from(marketplaceAddons)
          .where(
            and(
              eq(marketplaceAddons.addonId, addonId),
              eq(marketplaceAddons.published, true),
            ),
          )
          .limit(1),

        this.options.db
          .select()
          .from(addonVersions)
          .where(
            eq(
              addonVersions.marketplaceAddonId,
              sql`(
          SELECT id FROM ${marketplaceAddons} WHERE addon_id = ${addonId}
        )`,
            ),
          )
          .orderBy(desc(addonVersions.publishedAt)),

        this.options.db
          .select()
          .from(addonReviews)
          .where(
            eq(
              addonReviews.marketplaceAddonId,
              sql`(
          SELECT id FROM ${marketplaceAddons} WHERE addon_id = ${addonId}
        )`,
            ),
          )
          .orderBy(desc(addonReviews.createdAt))
          .limit(10),

        // Get related addons (same category, different author)
        this.options.db
          .select()
          .from(marketplaceAddons)
          .where(
            and(
              eq(marketplaceAddons.published, true),
              sql`${marketplaceAddons.category} = (SELECT category FROM ${marketplaceAddons} WHERE addon_id = ${addonId})`,
              sql`${marketplaceAddons.author} != (SELECT author FROM ${marketplaceAddons} WHERE addon_id = ${addonId})`,
            ),
          )
          .orderBy(desc(marketplaceAddons.rating))
          .limit(5),
      ]);

    return {
      addon: addonResult[0] || null,
      versions: versionsResult,
      reviews: reviewsResult,
      relatedAddons: relatedResult,
    };
  }

  /**
   * Publish new addon version to marketplace
   */
  async publishAddon(
    request: PublishAddonRequest,
    publisherId: string,
  ): Promise<{
    addon: MarketplaceAddon;
    version: AddonVersion;
    isNewAddon: boolean;
  }> {
    const {
      manifest,
      packageBuffer,
      changelog,
      isPrerelease = false,
    } = request;

    // Validate manifest and package
    const validation = await this.validateAddonPackage(manifest, packageBuffer);
    if (!validation.valid) {
      throw new Error(
        `Addon validation failed: ${validation.errors.join(', ')}`,
      );
    }

    // Upload package to storage
    const packageUrl = await this.options.storageService.uploadPackage(
      manifest.id,
      manifest.version,
      packageBuffer,
    );

    const packageHash = this.calculatePackageHash(packageBuffer);

    // Check if addon already exists
    const existingAddon = await this.options.db
      .select()
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.addonId, manifest.id))
      .limit(1);

    const isNewAddon = existingAddon.length === 0;
    let marketplaceAddon: MarketplaceAddon;

    if (isNewAddon) {
      // Create new marketplace addon
      const newAddon: NewMarketplaceAddon = {
        addonId: manifest.id,
        name: manifest.name,
        description: manifest.description,
        shortDescription: manifest.description?.substring(0, 500),
        version: manifest.version,
        author: manifest.author.name,
        authorEmail: manifest.author.email,
        authorUrl: manifest.author.url,
        repository: manifest.repository,
        homepage: manifest.homepage,
        license: manifest.license,
        manifest,
        packageUrl,
        packageSize: packageBuffer.length,
        packageHash,
        downloadCount: 0,
        rating: '0.00',
        ratingCount: 0,
        featured: false,
        verified: false,
        published: true,
        tags: this.extractTags(manifest),
        category: this.determineCategory(manifest),
        price: '0.00',
        currency: 'USD',
      };

      const [insertedAddon] = await this.options.db
        .insert(marketplaceAddons)
        .values(newAddon)
        .returning();

      marketplaceAddon = insertedAddon;
    } else {
      // Update existing addon
      const [updatedAddon] = await this.options.db
        .update(marketplaceAddons)
        .set({
          version: manifest.version,
          description: manifest.description,
          shortDescription: manifest.description?.substring(0, 500),
          manifest,
          packageUrl,
          packageSize: packageBuffer.length,
          packageHash,
          updatedAt: new Date(),
        })
        .where(eq(marketplaceAddons.addonId, manifest.id))
        .returning();

      marketplaceAddon = updatedAddon;

      // Update previous version to not be latest
      await this.options.db
        .update(addonVersions)
        .set({ isLatest: false })
        .where(
          and(
            eq(addonVersions.marketplaceAddonId, marketplaceAddon.id),
            eq(addonVersions.isLatest, true),
          ),
        );
    }

    // Create new version record
    const newVersion: NewAddonVersion = {
      marketplaceAddonId: marketplaceAddon.id,
      version: manifest.version,
      changelog,
      packageUrl,
      packageSize: packageBuffer.length,
      packageHash,
      downloadCount: 0,
      isLatest: true,
      isPrerelease,
      minOpenaidyVersion: manifest.openaidy.minVersion,
      maxOpenaidyVersion: manifest.openaidy.maxVersion,
      dependencies: manifest.dependencies || {},
    };

    const [insertedVersion] = await this.options.db
      .insert(addonVersions)
      .values(newVersion)
      .returning();

    return {
      addon: marketplaceAddon,
      version: insertedVersion,
      isNewAddon,
    };
  }

  /**
   * Record addon download
   */
  async recordDownload(
    addonId: string,
    version?: string,
    userId?: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
      source?: string;
    },
  ): Promise<void> {
    // Get marketplace addon
    const addon = await this.options.db
      .select()
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.addonId, addonId))
      .limit(1);

    if (!addon[0]) {
      throw new Error('Addon not found');
    }

    // Record download analytics
    await this.options.db.insert(addonDownloads).values({
      marketplaceAddonId: addon[0].id,
      version: version || addon[0].version,
      userId,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      referer: metadata?.referer,
      source: metadata?.source || 'marketplace',
    });

    // Update download counts
    await this.options.db
      .update(marketplaceAddons)
      .set({
        downloadCount: sql`${marketplaceAddons.downloadCount} + 1`,
      })
      .where(eq(marketplaceAddons.id, addon[0].id));

    if (version) {
      await this.options.db
        .update(addonVersions)
        .set({
          downloadCount: sql`${addonVersions.downloadCount} + 1`,
        })
        .where(
          and(
            eq(addonVersions.marketplaceAddonId, addon[0].id),
            eq(addonVersions.version, version),
          ),
        );
    }
  }

  /**
   * Add or update addon review
   */
  async upsertReview(
    addonId: string,
    userId: string,
    review: {
      rating: number;
      title?: string;
      content?: string;
      version?: string;
    },
  ): Promise<AddonReview> {
    // Get marketplace addon
    const addon = await this.options.db
      .select()
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.addonId, addonId))
      .limit(1);

    if (!addon[0]) {
      throw new Error('Addon not found');
    }

    // Check if review already exists
    const existingReview = await this.options.db
      .select()
      .from(addonReviews)
      .where(
        and(
          eq(addonReviews.marketplaceAddonId, addon[0].id),
          eq(addonReviews.userId, userId),
        ),
      )
      .limit(1);

    let reviewResult: AddonReview;

    if (existingReview[0]) {
      // Update existing review
      const [updated] = await this.options.db
        .update(addonReviews)
        .set({
          rating: review.rating,
          title: review.title,
          content: review.content,
          version: review.version,
          updatedAt: new Date(),
        })
        .where(eq(addonReviews.id, existingReview[0].id))
        .returning();

      reviewResult = updated;
    } else {
      // Create new review
      const [inserted] = await this.options.db
        .insert(addonReviews)
        .values({
          marketplaceAddonId: addon[0].id,
          userId,
          rating: review.rating,
          title: review.title,
          content: review.content,
          version: review.version,
          verified: false, // TODO: Check if user actually installed addon
        })
        .returning();

      reviewResult = inserted;
    }

    // Update addon rating
    await this.updateAddonRating(addon[0].id);

    return reviewResult;
  }

  /**
   * Get download analytics for addon
   */
  async getDownloadAnalytics(
    addonId: string,
    period: 'day' | 'week' | 'month' | 'year' = 'month',
  ): Promise<{
    totalDownloads: number;
    downloadsByPeriod: Array<{ date: string; downloads: number }>;
    downloadsByVersion: Array<{ version: string; downloads: number }>;
    topSources: Array<{ source: string; downloads: number }>;
  }> {
    const addon = await this.options.db
      .select()
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.addonId, addonId))
      .limit(1);

    if (!addon[0]) {
      throw new Error('Addon not found');
    }

    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;
    let dateFormat: string;

    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
        dateFormat = 'YYYY-MM-DD';
        break;
      case 'week':
        startDate = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000); // 12 weeks
        dateFormat = 'YYYY-["W"]WW'; // Year-Week
        break;
      case 'year':
        startDate = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000); // 5 years
        dateFormat = 'YYYY-MM';
        break;
      case 'month':
      default:
        startDate = new Date(now.getTime() - 24 * 30 * 24 * 60 * 60 * 1000); // 24 months
        dateFormat = 'YYYY-MM';
        break;
    }

    // Get total downloads
    const [totalResult] = await this.options.db
      .select({ count: sql<number>`count(*)` })
      .from(addonDownloads)
      .where(eq(addonDownloads.marketplaceAddonId, addon[0].id));

    // Get downloads by period
    const downloadsByPeriod = await this.options.db
      .select({
        date: sql<string>`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`,
        downloads: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .where(
        and(
          eq(addonDownloads.marketplaceAddonId, addon[0].id),
          sql`${addonDownloads.downloadedAt} >= ${startDate}`,
        ),
      )
      .groupBy(sql`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`)
      .orderBy(sql`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`);

    // Get downloads by version
    const downloadsByVersion = await this.options.db
      .select({
        version: addonVersions.version,
        downloads: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .leftJoin(addonVersions, eq(addonVersions.id, addonDownloads.versionId))
      .where(eq(addonDownloads.marketplaceAddonId, addon[0].id))
      .groupBy(addonVersions.version)
      .orderBy(desc(sql`count(*)`));

    // Get top sources
    const topSources = await this.options.db
      .select({
        source: addonDownloads.source,
        downloads: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .where(eq(addonDownloads.marketplaceAddonId, addon[0].id))
      .groupBy(addonDownloads.source)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    return {
      totalDownloads: totalResult?.count || 0,
      downloadsByPeriod,
      downloadsByVersion: downloadsByVersion.map((row) => ({
        version: row.version || 'unknown',
        downloads: row.downloads,
      })),
      topSources,
    };
  }

  /**
   * Private helper methods
   */
  private async validateAddonPackage(
    manifest: any,
    packageBuffer: Buffer,
  ): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    // Use existing validation from Phase 3
    // This is a placeholder - implement actual validation
    return {
      valid: true,
      errors: [],
      warnings: [],
    };
  }

  private calculatePackageHash(buffer: Buffer): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private extractTags(manifest: any): string[] {
    const tags: string[] = [];

    // Extract from permissions
    if (manifest.permissions) {
      manifest.permissions.forEach((perm: any) => {
        if (perm.type === 'agent') {
          tags.push('agent-integration');
        }
        if (perm.type === 'session') {
          tags.push('session-management');
        }
        if (perm.type === 'config') {
          tags.push('configuration');
        }
      });
    }

    // Extract from agents
    if (manifest.agents && manifest.agents.length > 0) {
      tags.push('ai-powered');
    }

    // Extract from UI complexity
    if (manifest.ui.routes.length > 1) {
      tags.push('multi-page');
    }

    // Extract from config
    if (manifest.config) {
      tags.push('configurable');
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  private determineCategory(manifest: any): string {
    // Simple category determination based on addon characteristics
    if (manifest.agents && manifest.agents.length > 0) {
      return 'ai-tools';
    }

    if (manifest.permissions.some((p: any) => p.type === 'session')) {
      return 'productivity';
    }

    if (manifest.config) {
      return 'utilities';
    }

    return 'general';
  }

  private async updateAddonRating(marketplaceAddonId: string): Promise<void> {
    const [ratingResult] = await this.options.db
      .select({
        averageRating: sql<number>`AVG(${addonReviews.rating})`,
        ratingCount: sql<number>`COUNT(*)`,
      })
      .from(addonReviews)
      .where(eq(addonReviews.marketplaceAddonId, marketplaceAddonId));

    if (ratingResult) {
      await this.options.db
        .update(marketplaceAddons)
        .set({
          rating: ratingResult.averageRating.toString(),
          ratingCount: ratingResult.ratingCount,
        })
        .where(eq(marketplaceAddons.id, marketplaceAddonId));
    }
  }
}

// Storage service interface
export interface StorageService {
  uploadPackage(
    addonId: string,
    version: string,
    packageBuffer: Buffer,
  ): Promise<string>;
  getPackageUrl(addonId: string, version: string): Promise<string>;
  deletePackage(addonId: string, version: string): Promise<void>;
}
```

### 2. Version Management System

#### 2.1 Create Version Manager

**File: `apps/server/src/marketplace/version-manager.ts`**

```typescript
import { semver } from 'semver';
import type { Database } from '@openaidy/db/client';
import { eq, and, desc } from 'drizzle-orm';
import {
  marketplaceAddons,
  addonVersions,
} from '@openaidy/db/schema/marketplace';

export interface VersionManagerOptions {
  db: Database;
  currentOpenaidyVersion: string;
}

export interface VersionCompatibility {
  compatible: boolean;
  reason?: string;
  suggestedVersion?: string;
}

export interface DependencyResolution {
  resolved: boolean;
  dependencies: Array<{
    addonId: string;
    version: string;
    available: boolean;
    reason?: string;
  }>;
  conflicts: Array<{
    addonId: string;
    conflictType: string;
    description: string;
  }>;
}

export class VersionManager {
  constructor(private options: VersionManagerOptions) {}

  /**
   * Check if addon version is compatible with current OpenAidy version
   */
  checkCompatibility(
    version: string,
    minVersion?: string,
    maxVersion?: string,
  ): VersionCompatibility {
    const currentVersion = this.options.currentOpenaidyVersion;

    try {
      // Check minimum version requirement
      if (
        minVersion &&
        !this.satisfiesVersion(currentVersion, `^${minVersion}`)
      ) {
        return {
          compatible: false,
          reason: `Requires OpenAidy ${minVersion} or higher, current version is ${currentVersion}`,
          suggestedVersion: minVersion,
        };
      }

      // Check maximum version requirement
      if (
        maxVersion &&
        !this.satisfiesVersion(currentVersion, `~${maxVersion}`)
      ) {
        return {
          compatible: false,
          reason: `Requires OpenAidy ${maxVersion} or lower, current version is ${currentVersion}`,
          suggestedVersion: maxVersion,
        };
      }

      return { compatible: true };
    } catch (error) {
      return {
        compatible: false,
        reason: 'Invalid version format',
      };
    }
  }

  /**
   * Resolve addon dependencies
   */
  async resolveDependencies(
    addonId: string,
    version: string,
  ): Promise<DependencyResolution> {
    // Get addon version with dependencies
    const addonVersion = await this.options.db
      .select({
        dependencies: addonVersions.dependencies,
      })
      .from(addonVersions)
      .innerJoin(
        marketplaceAddons,
        eq(marketplaceAddons.id, addonVersions.marketplaceAddonId),
      )
      .where(
        and(
          eq(marketplaceAddons.addonId, addonId),
          eq(addonVersions.version, version),
        ),
      )
      .limit(1);

    if (!addonVersion[0]) {
      return {
        resolved: false,
        dependencies: [],
        conflicts: [
          {
            addonId,
            conflictType: 'version_not_found',
            description: `Version ${version} not found for addon ${addonId}`,
          },
        ],
      };
    }

    const dependencies = addonVersion[0].dependencies;
    const resolvedDependencies: Array<{
      addonId: string;
      version: string;
      available: boolean;
      reason?: string;
    }> = [];

    const conflicts: Array<{
      addonId: string;
      conflictType: string;
      description: string;
    }> = [];

    // Resolve each dependency
    for (const [depAddonId, versionRange] of Object.entries(dependencies)) {
      try {
        const availableVersion = await this.findBestMatch(
          depAddonId,
          versionRange as string,
        );

        if (availableVersion) {
          resolvedDependencies.push({
            addonId: depAddonId,
            version: availableVersion,
            available: true,
          });
        } else {
          resolvedDependencies.push({
            addonId: depAddonId,
            version: versionRange as string,
            available: false,
            reason: 'No compatible version found',
          });
          conflicts.push({
            addonId: depAddonId,
            conflictType: 'dependency_unavailable',
            description: `No compatible version found for ${depAddonId}@${versionRange}`,
          });
        }
      } catch (error) {
        resolvedDependencies.push({
          addonId: depAddonId,
          version: versionRange as string,
          available: false,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
        conflicts.push({
          addonId: depAddonId,
          conflictType: 'dependency_error',
          description: `Error resolving dependency ${depAddonId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Check for circular dependencies
    const circularDeps = await this.detectCircularDependencies(
      addonId,
      version,
    );
    if (circularDeps.length > 0) {
      conflicts.push(
        ...circularDeps.map((dep) => ({
          addonId: dep.addonId,
          conflictType: 'circular_dependency',
          description: `Circular dependency detected: ${dep.cycle}`,
        })),
      );
    }

    return {
      resolved: conflicts.length === 0,
      dependencies: resolvedDependencies,
      conflicts,
    };
  }

  /**
   * Get available versions for an addon
   */
  async getAvailableVersions(addonId: string): Promise<
    Array<{
      version: string;
      isLatest: boolean;
      isPrerelease: boolean;
      publishedAt: string;
      downloadCount: number;
      compatible: boolean;
    }>
  > {
    const versions = await this.options.db
      .select({
        version: addonVersions.version,
        isLatest: addonVersions.isLatest,
        isPrerelease: addonVersions.isPrerelease,
        publishedAt: addonVersions.publishedAt,
        downloadCount: addonVersions.downloadCount,
        minOpenaidyVersion: addonVersions.minOpenaidyVersion,
        maxOpenaidyVersion: addonVersions.maxOpenaidyVersion,
      })
      .from(addonVersions)
      .innerJoin(
        marketplaceAddons,
        eq(marketplaceAddons.id, addonVersions.marketplaceAddonId),
      )
      .where(
        and(
          eq(marketplaceAddons.addonId, addonId),
          eq(marketplaceAddons.published, true),
        ),
      )
      .orderBy(desc(addonVersions.publishedAt));

    return versions.map((v) => ({
      ...v,
      compatible: this.checkCompatibility(
        v.version,
        v.minOpenaidyVersion || undefined,
        v.maxOpenaidyVersion || undefined,
      ).compatible,
    }));
  }

  /**
   * Get latest compatible version for an addon
   */
  async getLatestCompatibleVersion(addonId: string): Promise<string | null> {
    const versions = await this.getAvailableVersions(addonId);
    const compatibleVersions = versions.filter(
      (v) => v.compatible && !v.isPrerelease,
    );

    if (compatibleVersions.length === 0) {
      return null;
    }

    // Return the latest compatible version
    return compatibleVersions[0].version;
  }

  /**
   * Check for updates for installed addons
   */
  async checkForUpdates(
    installedAddons: Array<{
      addonId: string;
      currentVersion: string;
    }>,
  ): Promise<
    Array<{
      addonId: string;
      currentVersion: string;
      latestVersion: string;
      updateAvailable: boolean;
      updateType: 'patch' | 'minor' | 'major' | 'prerelease';
      compatible: boolean;
    }>
  > {
    const updateResults = [];

    for (const installed of installedAddons) {
      const versions = await this.getAvailableVersions(installed.addonId);
      const latestVersion = versions.find((v) => v.isLatest && !v.isPrerelease);

      if (!latestVersion) {
        continue;
      }

      const updateAvailable =
        this.compareVersions(installed.currentVersion, latestVersion.version) <
        0;

      const updateType = updateAvailable
        ? this.getUpdateType(installed.currentVersion, latestVersion.version)
        : ('patch' as any);

      updateResults.push({
        addonId: installed.addonId,
        currentVersion: installed.currentVersion,
        latestVersion: latestVersion.version,
        updateAvailable,
        updateType,
        compatible: latestVersion.compatible,
      });
    }

    return updateResults;
  }

  /**
   * Private helper methods
   */
  private satisfiesVersion(version: string, range: string): boolean {
    try {
      return semver.satisfies(version, range);
    } catch {
      return false;
    }
  }

  private compareVersions(version1: string, version2: string): number {
    try {
      return semver.compare(version1, version2);
    } catch {
      return 0;
    }
  }

  private getUpdateType(
    current: string,
    latest: string,
  ): 'patch' | 'minor' | 'major' {
    try {
      const currentSemver = semver.parse(current);
      const latestSemver = semver.parse(latest);

      if (!currentSemver || !latestSemver) {
        return 'patch';
      }

      if (latestSemver.major > currentSemver.major) {
        return 'major';
      } else if (latestSemver.minor > currentSemver.minor) {
        return 'minor';
      } else {
        return 'patch';
      }
    } catch {
      return 'patch';
    }
  }

  private async findBestMatch(
    addonId: string,
    versionRange: string,
  ): Promise<string | null> {
    const versions = await this.getAvailableVersions(addonId);

    for (const v of versions) {
      if (this.satisfiesVersion(v.version, versionRange)) {
        return v.version;
      }
    }

    return null;
  }

  private async detectCircularDependencies(
    addonId: string,
    version: string,
    visited: Set<string> = new Set(),
    path: string[] = [],
  ): Promise<Array<{ addonId: string; cycle: string }>> {
    const key = `${addonId}@${version}`;

    if (visited.has(key)) {
      const cycleStart = path.indexOf(key);
      if (cycleStart !== -1) {
        return [
          {
            addonId,
            cycle: [...path.slice(cycleStart), key].join(' -> '),
          },
        ];
      }
      return [];
    }

    visited.add(key);
    path.push(key);

    // Get dependencies for this version
    const addonVersion = await this.options.db
      .select({
        dependencies: addonVersions.dependencies,
      })
      .from(addonVersions)
      .innerJoin(
        marketplaceAddons,
        eq(marketplaceAddons.id, addonVersions.marketplaceAddonId),
      )
      .where(
        and(
          eq(marketplaceAddons.addonId, addonId),
          eq(addonVersions.version, version),
        ),
      )
      .limit(1);

    if (!addonVersion[0]) {
      return [];
    }

    const dependencies = addonVersion[0].dependencies;
    const circularDeps: Array<{ addonId: string; cycle: string }> = [];

    for (const [depAddonId, versionRange] of Object.entries(dependencies)) {
      const bestMatch = await this.findBestMatch(
        depAddonId,
        versionRange as string,
      );
      if (bestMatch) {
        const deps = await this.detectCircularDependencies(
          depAddonId,
          bestMatch,
          new Set(visited),
          [...path],
        );
        circularDeps.push(...deps);
      }
    }

    return circularDeps;
  }
}
```

### 3. Analytics Dashboard

#### 3.1 Create Analytics Service

**File: `apps/server/src/analytics/service.ts`**

```typescript
import type { Database } from '@openaidy/db/client';
import { eq, and, gte, lte, sql, desc, asc } from 'drizzle-orm';
import {
  marketplaceAddons,
  addonDownloads,
  addonReviews,
  addonUsage,
} from '@openaidy/db/schema/marketplace';
import { addons } from '@openaidy/db/schema/addons';

export interface AnalyticsServiceOptions {
  db: Database;
}

export interface AnalyticsTimeRange {
  start: Date;
  end: Date;
}

export interface AnalyticsMetrics {
  totalAddons: number;
  totalDownloads: number;
  totalReviews: number;
  averageRating: number;
  activeUsers: number;
  topCategories: Array<{
    category: string;
    addonCount: number;
    downloadCount: number;
  }>;
  recentGrowth: {
    downloads: number;
    newAddons: number;
    newReviews: number;
  };
}

export interface AddonAnalytics {
  addonId: string;
  name: string;
  totalDownloads: number;
  recentDownloads: number;
  averageRating: number;
  reviewCount: number;
  activeUsers: number;
  usage: Array<{
    date: string;
    requests: number;
    users: number;
  }>;
  demographics: {
    sources: Array<{ source: string; count: number; percentage: number }>;
    versions: Array<{ version: string; count: number; percentage: number }>;
    geography: Array<{ country: string; count: number; percentage: number }>;
  };
}

export class AnalyticsService {
  constructor(private options: AnalyticsServiceOptions) {}

  /**
   * Get overall marketplace analytics
   */
  async getMarketplaceAnalytics(
    timeRange: AnalyticsTimeRange,
  ): Promise<AnalyticsMetrics> {
    const { start, end } = timeRange;

    const [
      totalAddonsResult,
      totalDownloadsResult,
      totalReviewsResult,
      averageRatingResult,
      activeUsersResult,
      topCategoriesResult,
      recentGrowthResult,
    ] = await Promise.all([
      // Total published addons
      this.options.db
        .select({ count: sql<number>`count(*)` })
        .from(marketplaceAddons)
        .where(eq(marketplaceAddons.published, true)),

      // Total downloads
      this.options.db
        .select({ count: sql<number>`count(*)` })
        .from(addonDownloads),

      // Total reviews
      this.options.db
        .select({ count: sql<number>`count(*)` })
        .from(addonReviews),

      // Average rating
      this.options.db
        .select({ avgRating: sql<number>`AVG(${marketplaceAddons.rating})` })
        .from(marketplaceAddons)
        .where(
          and(
            eq(marketplaceAddons.published, true),
            sql`${marketplaceAddons.rating} > 0`,
          ),
        ),

      // Active users (users who downloaded addons in time range)
      this.options.db
        .select({ count: sql<number>`count(DISTINCT user_id)` })
        .from(addonDownloads)
        .where(
          and(
            gte(addonDownloads.downloadedAt, start),
            lte(addonDownloads.downloadedAt, end),
          ),
        ),

      // Top categories
      this.options.db
        .select({
          category: marketplaceAddons.category,
          addonCount: sql<number>`count(*)`,
          downloadCount: sql<number>`SUM(${marketplaceAddons.downloadCount})`,
        })
        .from(marketplaceAddons)
        .where(
          and(
            eq(marketplaceAddons.published, true),
            sql`${marketplaceAddons.category} IS NOT NULL`,
          ),
        )
        .groupBy(marketplaceAddons.category)
        .orderBy(desc(sql`SUM(${marketplaceAddons.downloadCount})`))
        .limit(10),

      // Recent growth (within time range)
      this.options.db
        .select({
          downloads: sql<number>`count(*)`,
        })
        .from(addonDownloads)
        .where(
          and(
            gte(addonDownloads.downloadedAt, start),
            lte(addonDownloads.downloadedAt, end),
          ),
        ),
    ]);

    // Get new addons and reviews in time range
    const [newAddonsResult, newReviewsResult] = await Promise.all([
      this.options.db
        .select({ count: sql<number>`count(*)` })
        .from(marketplaceAddons)
        .where(
          and(
            eq(marketplaceAddons.published, true),
            gte(marketplaceAddons.publishedAt, start),
            lte(marketplaceAddons.publishedAt, end),
          ),
        ),

      this.options.db
        .select({ count: sql<number>`count(*)` })
        .from(addonReviews)
        .where(
          and(
            gte(addonReviews.createdAt, start),
            lte(addonReviews.createdAt, end),
          ),
        ),
    ]);

    return {
      totalAddons: totalAddonsResult[0]?.count || 0,
      totalDownloads: totalDownloadsResult[0]?.count || 0,
      totalReviews: totalReviewsResult[0]?.count || 0,
      averageRating: averageRatingResult[0]?.avgRating || 0,
      activeUsers: activeUsersResult[0]?.count || 0,
      topCategories: topCategoriesResult.map((row) => ({
        category: row.category || 'unknown',
        addonCount: row.addonCount,
        downloadCount: Number(row.downloadCount),
      })),
      recentGrowth: {
        downloads: recentGrowthResult[0]?.downloads || 0,
        newAddons: newAddonsResult[0]?.count || 0,
        newReviews: newReviewsResult[0]?.count || 0,
      },
    };
  }

  /**
   * Get detailed analytics for a specific addon
   */
  async getAddonAnalytics(
    addonId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<AddonAnalytics> {
    const { start, end } = timeRange;

    // Get addon details
    const addon = await this.options.db
      .select({
        id: marketplaceAddons.id,
        name: marketplaceAddons.name,
        downloadCount: marketplaceAddons.downloadCount,
        rating: marketplaceAddons.rating,
        ratingCount: marketplaceAddons.ratingCount,
      })
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.addonId, addonId))
      .limit(1);

    if (!addon[0]) {
      throw new Error('Addon not found');
    }

    const addonData = addon[0];

    // Get recent downloads
    const recentDownloadsResult = await this.options.db
      .select({ count: sql<number>`count(*)` })
      .from(addonDownloads)
      .where(
        and(
          eq(addonDownloads.marketplaceAddonId, addonData.id),
          gte(addonDownloads.downloadedAt, start),
          lte(addonDownloads.downloadedAt, end),
        ),
      );

    // Get active users (unique users in time range)
    const activeUsersResult = await this.options.db
      .select({ count: sql<number>`count(DISTINCT user_id)` })
      .from(addonDownloads)
      .where(
        and(
          eq(addonDownloads.marketplaceAddonId, addonData.id),
          gte(addonDownloads.downloadedAt, start),
          lte(addonDownloads.downloadedAt, end),
        ),
      );

    // Get usage over time
    const usageOverTime = await this.options.db
      .select({
        date: sql<string>`date(${addonDownloads.downloadedAt})`,
        requests: sql<number>`count(*)`,
        users: sql<number>`count(DISTINCT user_id)`,
      })
      .from(addonDownloads)
      .where(
        and(
          eq(addonDownloads.marketplaceAddonId, addonData.id),
          gte(addonDownloads.downloadedAt, start),
          lte(addonDownloads.downloadedAt, end),
        ),
      )
      .groupBy(sql`date(${addonDownloads.downloadedAt})`)
      .orderBy(asc(sql`date(${addonDownloads.downloadedAt})`));

    // Get source demographics
    const sourceDemographics = await this.options.db
      .select({
        source: addonDownloads.source,
        count: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .where(eq(addonDownloads.marketplaceAddonId, addonData.id))
      .groupBy(addonDownloads.source)
      .orderBy(desc(sql`count(*)`));

    const totalSourceDownloads = sourceDemographics.reduce(
      (sum, row) => sum + row.count,
      0,
    );

    // Get version demographics
    const versionDemographics = await this.options.db
      .select({
        version: addonDownloads.version,
        count: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .where(eq(addonDownloads.marketplaceAddonId, addonData.id))
      .groupBy(addonDownloads.version)
      .orderBy(desc(sql`count(*)`));

    const totalVersionDownloads = versionDemographics.reduce(
      (sum, row) => sum + row.count,
      0,
    );

    // Get geography demographics (simplified - would need IP geolocation in real implementation)
    const geographyDemographics = await this.options.db
      .select({
        country: sql<string>`'Unknown'`, // Placeholder - would extract from IP
        count: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .where(eq(addonDownloads.marketplaceAddonId, addonData.id))
      .groupBy(sql`'Unknown'`) // Placeholder
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const totalGeographyDownloads = geographyDemographics.reduce(
      (sum, row) => sum + row.count,
      0,
    );

    return {
      addonId,
      name: addonData.name,
      totalDownloads: addonData.downloadCount,
      recentDownloads: recentDownloadsResult[0]?.count || 0,
      averageRating: Number(addonData.rating),
      reviewCount: addonData.ratingCount,
      activeUsers: activeUsersResult[0]?.count || 0,
      usage: usageOverTime.map((row) => ({
        date: row.date,
        requests: row.requests,
        users: row.users,
      })),
      demographics: {
        sources: sourceDemographics.map((row) => ({
          source: row.source || 'unknown',
          count: row.count,
          percentage:
            totalSourceDownloads > 0
              ? (row.count / totalSourceDownloads) * 100
              : 0,
        })),
        versions: versionDemographics.map((row) => ({
          version: row.version || 'unknown',
          count: row.count,
          percentage:
            totalVersionDownloads > 0
              ? (row.count / totalVersionDownloads) * 100
              : 0,
        })),
        geography: geographyDemographics.map((row) => ({
          country: row.country,
          count: row.count,
          percentage:
            totalGeographyDownloads > 0
              ? (row.count / totalGeographyDownloads) * 100
              : 0,
        })),
      },
    };
  }

  /**
   * Get popular addons based on various metrics
   */
  async getPopularAddons(
    metric: 'downloads' | 'rating' | 'recent' = 'downloads',
    limit: number = 10,
    timeRange?: AnalyticsTimeRange,
  ): Promise<
    Array<{
      addonId: string;
      name: string;
      description: string;
      author: string;
      category: string;
      downloads: number;
      rating: number;
      reviewCount: number;
      publishedAt: string;
    }>
  > {
    let query = this.options.db
      .select({
        addonId: marketplaceAddons.addonId,
        name: marketplaceAddons.name,
        description: marketplaceAddons.description,
        author: marketplaceAddons.author,
        category: marketplaceAddons.category,
        downloads: marketplaceAddons.downloadCount,
        rating: marketplaceAddons.rating,
        reviewCount: marketplaceAddons.ratingCount,
        publishedAt: marketplaceAddons.publishedAt,
      })
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.published, true));

    // Apply time range filter for recent metrics
    if (metric === 'recent' && timeRange) {
      // This would require joining with downloads table and filtering by date
      // Simplified for now
    }

    // Apply ordering based on metric
    switch (metric) {
      case 'rating':
        query = query.orderBy(
          desc(marketplaceAddons.rating),
          desc(marketplaceAddons.ratingCount),
        );
        break;
      case 'recent':
        query = query.orderBy(desc(marketplaceAddons.publishedAt));
        break;
      case 'downloads':
      default:
        query = query.orderBy(desc(marketplaceAddons.downloadCount));
        break;
    }

    const results = await query.limit(limit);

    return results.map((row) => ({
      ...row,
      rating: Number(row.rating),
    }));
  }

  /**
   * Get usage trends for the marketplace
   */
  async getUsageTrends(
    timeRange: AnalyticsTimeRange,
    granularity: 'day' | 'week' | 'month' = 'day',
  ): Promise<
    Array<{
      date: string;
      downloads: number;
      newAddons: number;
      newReviews: number;
      activeUsers: number;
    }>
  > {
    const { start, end } = timeRange;

    let dateFormat: string;
    switch (granularity) {
      case 'week':
        dateFormat = 'YYYY-"W"WW';
        break;
      case 'month':
        dateFormat = 'YYYY-MM';
        break;
      case 'day':
      default:
        dateFormat = 'YYYY-MM-DD';
        break;
    }

    // Get downloads trend
    const downloadsTrend = await this.options.db
      .select({
        date: sql<string>`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`,
        downloads: sql<number>`count(*)`,
      })
      .from(addonDownloads)
      .where(
        and(
          gte(addonDownloads.downloadedAt, start),
          lte(addonDownloads.downloadedAt, end),
        ),
      )
      .groupBy(sql`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`);

    // Get new addons trend
    const newAddonsTrend = await this.options.db
      .select({
        date: sql<string>`to_char(${marketplaceAddons.publishedAt}, ${dateFormat})`,
        newAddons: sql<number>`count(*)`,
      })
      .from(marketplaceAddons)
      .where(
        and(
          eq(marketplaceAddons.published, true),
          gte(marketplaceAddons.publishedAt, start),
          lte(marketplaceAddons.publishedAt, end),
        ),
      )
      .groupBy(sql`to_char(${marketplaceAddons.publishedAt}, ${dateFormat})`);

    // Get new reviews trend
    const newReviewsTrend = await this.options.db
      .select({
        date: sql<string>`to_char(${addonReviews.createdAt}, ${dateFormat})`,
        newReviews: sql<number>`count(*)`,
      })
      .from(addonReviews)
      .where(
        and(
          gte(addonReviews.createdAt, start),
          lte(addonReviews.createdAt, end),
        ),
      )
      .groupBy(sql`to_char(${addonReviews.createdAt}, ${dateFormat})`);

    // Get active users trend
    const activeUsersTrend = await this.options.db
      .select({
        date: sql<string>`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`,
        activeUsers: sql<number>`count(DISTINCT user_id)`,
      })
      .from(addonDownloads)
      .where(
        and(
          gte(addonDownloads.downloadedAt, start),
          lte(addonDownloads.downloadedAt, end),
        ),
      )
      .groupBy(sql`to_char(${addonDownloads.downloadedAt}, ${dateFormat})`);

    // Merge all trends
    const allDates = new Set([
      ...downloadsTrend.map((row) => row.date),
      ...newAddonsTrend.map((row) => row.date),
      ...newReviewsTrend.map((row) => row.date),
      ...activeUsersTrend.map((row) => row.date),
    ]);

    return Array.from(allDates)
      .sort()
      .map((date) => {
        const downloadsRow = downloadsTrend.find((row) => row.date === date);
        const newAddonsRow = newAddonsTrend.find((row) => row.date === date);
        const newReviewsRow = newReviewsTrend.find((row) => row.date === date);
        const activeUsersRow = activeUsersTrend.find(
          (row) => row.date === date,
        );

        return {
          date,
          downloads: downloadsRow?.downloads || 0,
          newAddons: newAddonsRow?.newAddons || 0,
          newReviews: newReviewsRow?.newReviews || 0,
          activeUsers: activeUsersRow?.activeUsers || 0,
        };
      });
  }
}
```

### 4. Monetization Support

#### 4.1 Create Licensing Service

**File: `apps/server/src/marketplace/licensing.ts`**

```typescript
import type { Database } from '@openaidy/db/client';
import { eq, and, sql } from 'drizzle-orm';
import {
  marketplaceAddons,
  addonLicenses,
} from '@openaidy/db/schema/marketplace';

export interface LicenseOptions {
  db: Database;
  paymentProcessor: PaymentProcessor;
}

export interface License {
  id: string;
  addonId: string;
  userId: string;
  type: 'trial' | 'basic' | 'premium' | 'enterprise';
  status: 'active' | 'expired' | 'suspended' | 'cancelled';
  expiresAt?: string;
  features: string[];
  usageLimits: {
    requests: number;
    users: number;
    storage: number;
  };
  currentUsage: {
    requests: number;
    users: number;
    storage: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LicenseTier {
  type: 'trial' | 'basic' | 'premium' | 'enterprise';
  name: string;
  price: number;
  currency: string;
  interval: 'monthly' | 'yearly' | 'lifetime';
  features: string[];
  limits: {
    requests: number;
    users: number;
    storage: number;
  };
  trialDays?: number;
}

export class LicensingService {
  constructor(private options: LicenseOptions) {}

  /**
   * Get available license tiers for an addon
   */
  async getLicenseTiers(addonId: string): Promise<LicenseTier[]> {
    const addon = await this.options.db
      .select({
        price: marketplaceAddons.price,
        currency: marketplaceAddons.currency,
      })
      .from(marketplaceAddons)
      .where(eq(marketplaceAddons.addonId, addonId))
      .limit(1);

    if (!addon[0]) {
      throw new Error('Addon not found');
    }

    const basePrice = Number(addon[0].price);
    const currency = addon[0].currency;

    // Define standard tiers - in real implementation, this would be configurable per addon
    const tiers: LicenseTier[] = [];

    if (basePrice === 0) {
      // Free addon
      tiers.push({
        type: 'basic',
        name: 'Free',
        price: 0,
        currency,
        interval: 'lifetime',
        features: ['Core functionality', 'Community support'],
        limits: {
          requests: 1000,
          users: 5,
          storage: 100, // MB
        },
      });
    } else {
      // Paid addon tiers
      tiers.push({
        type: 'trial',
        name: 'Trial',
        price: 0,
        currency,
        interval: 'monthly',
        features: ['Full functionality', 'Email support'],
        limits: {
          requests: 100,
          users: 1,
          storage: 10,
        },
        trialDays: 14,
      });

      tiers.push({
        type: 'basic',
        name: 'Basic',
        price: basePrice,
        currency,
        interval: 'monthly',
        features: ['Core functionality', 'Email support', 'Basic analytics'],
        limits: {
          requests: 10000,
          users: 10,
          storage: 1000,
        },
      });

      tiers.push({
        type: 'premium',
        name: 'Premium',
        price: basePrice * 3,
        currency,
        interval: 'monthly',
        features: [
          'All features',
          'Priority support',
          'Advanced analytics',
          'API access',
        ],
        limits: {
          requests: 100000,
          users: 50,
          storage: 10000,
        },
      });

      tiers.push({
        type: 'enterprise',
        name: 'Enterprise',
        price: basePrice * 10,
        currency,
        interval: 'monthly',
        features: [
          'All features',
          'Dedicated support',
          'Custom integrations',
          'SLA guarantee',
        ],
        limits: {
          requests: -1, // Unlimited
          users: -1, // Unlimited
          storage: -1, // Unlimited
        },
      });
    }

    return tiers;
  }

  /**
   * Create or update license for user
   */
  async createLicense(
    addonId: string,
    userId: string,
    tierType: string,
    paymentId?: string,
  ): Promise<License> {
    const tiers = await this.getLicenseTiers(addonId);
    const tier = tiers.find((t) => t.type === tierType);

    if (!tier) {
      throw new Error(`Invalid license tier: ${tierType}`);
    }

    // Check if user already has a license
    const existingLicense = await this.options.db
      .select()
      .from(addonLicenses)
      .where(
        and(
          eq(addonLicenses.addonId, addonId),
          eq(addonLicenses.userId, userId),
          eq(addonLicenses.status, 'active'),
        ),
      )
      .limit(1);

    let expiresAt: Date | undefined;

    if (tier.interval === 'lifetime') {
      expiresAt = undefined; // Never expires
    } else if (tier.type === 'trial') {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (tier.trialDays || 14));
    } else {
      expiresAt = new Date();
      expiresAt.setMonth(
        expiresAt.getMonth() + (tier.interval === 'yearly' ? 12 : 1),
      );
    }

    const licenseData = {
      addonId,
      userId,
      type: tier.type,
      status: 'active' as const,
      expiresAt: expiresAt?.toISOString(),
      features: tier.features,
      limits: tier.limits,
      usage: {
        requests: 0,
        users: 0,
        storage: 0,
      },
      paymentId,
    };

    let license: any;

    if (existingLicense[0]) {
      // Update existing license
      const [updated] = await this.options.db
        .update(addonLicenses)
        .set({
          ...licenseData,
          updatedAt: new Date(),
        })
        .where(eq(addonLicenses.id, existingLicense[0].id))
        .returning();

      license = updated;
    } else {
      // Create new license
      const [created] = await this.options.db
        .insert(addonLicenses)
        .values({
          ...licenseData,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      license = created;
    }

    return this.mapLicenseToResponse(license);
  }

  /**
   * Get user's license for an addon
   */
  async getUserLicense(
    addonId: string,
    userId: string,
  ): Promise<License | null> {
    const license = await this.options.db
      .select()
      .from(addonLicenses)
      .where(
        and(
          eq(addonLicenses.addonId, addonId),
          eq(addonLicenses.userId, userId),
          eq(addonLicenses.status, 'active'),
        ),
      )
      .limit(1);

    if (!license[0]) {
      return null;
    }

    // Check if license has expired
    if (license[0].expiresAt && new Date(license[0].expiresAt) < new Date()) {
      await this.options.db
        .update(addonLicenses)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(addonLicenses.id, license[0].id));

      return null;
    }

    return this.mapLicenseToResponse(license[0]);
  }

  /**
   * Check if user has permission to use addon
   */
  async checkPermission(
    addonId: string,
    userId: string,
    feature?: string,
    additionalUsage?: {
      requests?: number;
      storage?: number;
    },
  ): Promise<{
    allowed: boolean;
    reason?: string;
    license?: License;
  }> {
    const license = await this.getUserLicense(addonId, userId);

    if (!license) {
      return {
        allowed: false,
        reason: 'No active license found',
      };
    }

    // Check feature access
    if (feature && !license.features.includes(feature)) {
      return {
        allowed: false,
        reason: `Feature '${feature}' not available in ${license.type} license`,
        license,
      };
    }

    // Check usage limits
    if (license.usageLimits.requests > 0) {
      const newRequestUsage =
        license.currentUsage.requests + (additionalUsage?.requests || 1);
      if (newRequestUsage > license.usageLimits.requests) {
        return {
          allowed: false,
          reason: 'Request limit exceeded',
          license,
        };
      }
    }

    if (license.usageLimits.storage > 0 && additionalUsage?.storage) {
      const newStorageUsage =
        license.currentUsage.storage + additionalUsage.storage;
      if (newStorageUsage > license.usageLimits.storage) {
        return {
          allowed: false,
          reason: 'Storage limit exceeded',
          license,
        };
      }
    }

    return {
      allowed: true,
      license,
    };
  }

  /**
   * Record usage for license
   */
  async recordUsage(
    addonId: string,
    userId: string,
    usage: {
      requests?: number;
      users?: number;
      storage?: number;
    },
  ): Promise<void> {
    const license = await this.getUserLicense(addonId, userId);

    if (!license) {
      throw new Error('No active license found');
    }

    // Update usage
    const newUsage = {
      requests: license.currentUsage.requests + (usage.requests || 0),
      users: license.currentUsage.users + (usage.users || 0),
      storage: license.currentUsage.storage + (usage.storage || 0),
    };

    await this.options.db
      .update(addonLicenses)
      .set({
        usage: newUsage,
        updatedAt: new Date(),
      })
      .where(eq(addonLicenses.id, license.id));
  }

  /**
   * Cancel license
   */
  async cancelLicense(addonId: string, userId: string): Promise<void> {
    await this.options.db
      .update(addonLicenses)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(addonLicenses.addonId, addonId),
          eq(addonLicenses.userId, userId),
        ),
      );
  }

  /**
   * Process subscription renewal
   */
  async processRenewal(paymentId: string): Promise<void> {
    // Get payment details from payment processor
    const payment = await this.options.paymentProcessor.getPayment(paymentId);

    if (!payment || payment.status !== 'completed') {
      throw new Error('Invalid payment');
    }

    // Extract addon and user info from payment metadata
    const { addonId, userId, tierType } = payment.metadata;

    // Create new license
    await this.createLicense(addonId, userId, tierType, paymentId);
  }

  private mapLicenseToResponse(dbLicense: any): License {
    return {
      id: dbLicense.id,
      addonId: dbLicense.addonId,
      userId: dbLicense.userId,
      type: dbLicense.type,
      status: dbLicense.status,
      expiresAt: dbLicense.expiresAt,
      features: dbLicense.features,
      usageLimits: dbLicense.limits,
      currentUsage: dbLicense.usage,
      createdAt: dbLicense.createdAt,
      updatedAt: dbLicense.updatedAt,
    };
  }
}

// Payment processor interface
export interface PaymentProcessor {
  getPayment(paymentId: string): Promise<{
    id: string;
    status: 'pending' | 'completed' | 'failed' | 'refunded';
    amount: number;
    currency: string;
    metadata: Record<string, any>;
  }>;
  createPayment(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
  ): Promise<{
    id: string;
    url: string;
  }>;
}
```

### 5. Marketplace API Routes

#### 5.1 Create Marketplace API

**File: `apps/server/src/routes/marketplace.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { MarketplaceService } from '../marketplace/service';
import type { AnalyticsService } from '../analytics/service';
import type { LicensingService } from '../marketplace/licensing';
import { requireAuth } from '../middleware/require-auth';
import type { AuthMiddleware } from '../websocket/middleware/auth';

export type MarketplaceRoutesOptions = {
  marketplaceService: MarketplaceService;
  analyticsService: AnalyticsService;
  licensingService: LicensingService;
  authMiddleware: AuthMiddleware;
};

export const marketplaceRoutes: FastifyPluginAsync<
  MarketplaceRoutesOptions
> = async (app, options) => {
  const {
    marketplaceService,
    analyticsService,
    licensingService,
    authMiddleware,
  } = options;

  /**
   * GET /api/marketplace/addons
   * Search and browse addons
   */
  app.get<{
    Querystring: {
      q?: string;
      category?: string;
      tags?: string;
      author?: string;
      featured?: string;
      verified?: string;
      free?: string;
      minRating?: string;
      sortBy?: string;
      sortOrder?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/marketplace/addons', async (request, reply) => {
    try {
      const searchOptions = {
        query: request.query.q,
        category: request.query.category,
        tags: request.query.tags ? request.query.tags.split(',') : undefined,
        author: request.query.author,
        featured: request.query.featured === 'true',
        verified: request.query.verified === 'true',
        free: request.query.free === 'true',
        minRating: request.query.minRating
          ? parseInt(request.query.minRating)
          : undefined,
        sortBy: request.query.sortBy as any,
        sortOrder: request.query.sortOrder as any,
        limit: request.query.limit ? parseInt(request.query.limit) : undefined,
        offset: request.query.offset
          ? parseInt(request.query.offset)
          : undefined,
      };

      const result = await marketplaceService.searchAddons(searchOptions);
      return reply.send(result);
    } catch (error) {
      return reply.code(500).send({
        error: 'search_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/marketplace/addons/:id
   * Get addon details
   */
  app.get<{
    Params: { id: string };
  }>('/api/marketplace/addons/:id', async (request, reply) => {
    try {
      const result = await marketplaceService.getAddonDetails(
        request.params.id,
      );

      if (!result.addon) {
        return reply.code(404).send({
          error: 'addon_not_found',
          message: 'Addon not found',
        });
      }

      return reply.send(result);
    } catch (error) {
      return reply.code(500).send({
        error: 'fetch_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/marketplace/addons/:id/download
   * Download addon
   */
  app.post<{
    Params: { id: string };
    Querystring: { version?: string };
  }>(
    '/api/marketplace/addons/:id/download',
    {
      preHandler: requireAuth({
        authMiddleware,
        requiredScope: 'addons.download',
      }),
    },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const version = request.query.version;

        // Record download
        await marketplaceService.recordDownload(
          request.params.id,
          version,
          userId,
          {
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            referer: request.headers.referer,
            source: 'api',
          },
        );

        // Get download URL
        const addon = await marketplaceService.getAddonDetails(
          request.params.id,
        );
        if (!addon.addon) {
          return reply.code(404).send({
            error: 'addon_not_found',
            message: 'Addon not found',
          });
        }

        const targetVersion = version || addon.addon.version;
        const versionData = addon.versions.find(
          (v) => v.version === targetVersion,
        );

        if (!versionData) {
          return reply.code(404).send({
            error: 'version_not_found',
            message: 'Version not found',
          });
        }

        return reply.send({
          downloadUrl: versionData.packageUrl,
          version: targetVersion,
          size: versionData.packageSize,
          hash: versionData.packageHash,
        });
      } catch (error) {
        return reply.code(500).send({
          error: 'download_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * POST /api/marketplace/addons
   * Publish new addon
   */
  app.post<{
    Body: {
      manifest: any;
      packageData: string; // Base64 encoded
      changelog?: string;
      isPrerelease?: boolean;
    };
  }>(
    '/api/marketplace/addons',
    {
      preHandler: requireAuth({
        authMiddleware,
        requiredScope: 'addons.publish',
      }),
    },
    async (request, reply) => {
      try {
        const packageBuffer = Buffer.from(request.body.packageData, 'base64');

        const result = await marketplaceService.publishAddon(
          {
            manifest: request.body.manifest,
            packageBuffer,
            changelog: request.body.changelog,
            isPrerelease: request.body.isPrerelease,
          },
          request.user.sub,
        );

        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: 'publish_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/marketplace/analytics
   * Get marketplace analytics (admin only)
   */
  app.get<{
    Querystring: {
      start?: string;
      end?: string;
    };
  }>(
    '/api/marketplace/analytics',
    {
      preHandler: requireAuth({
        authMiddleware,
        requiredScope: 'system.analytics',
      }),
    },
    async (request, reply) => {
      try {
        const timeRange = {
          start: request.query.start
            ? new Date(request.query.start)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: request.query.end ? new Date(request.query.end) : new Date(),
        };

        const analytics =
          await analyticsService.getMarketplaceAnalytics(timeRange);
        return reply.send(analytics);
      } catch (error) {
        return reply.code(500).send({
          error: 'analytics_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/marketplace/addons/:id/analytics
   * Get addon analytics (addon owner only)
   */
  app.get<{
    Params: { id: string };
    Querystring: {
      start?: string;
      end?: string;
    };
  }>(
    '/api/marketplace/addons/:id/analytics',
    {
      preHandler: requireAuth({ authMiddleware }),
    },
    async (request, reply) => {
      try {
        // Check if user owns the addon
        const addon = await marketplaceService.getAddonDetails(
          request.params.id,
        );
        if (!addon.addon) {
          return reply.code(404).send({
            error: 'addon_not_found',
            message: 'Addon not found',
          });
        }

        // Simple ownership check - in real implementation, this would be more sophisticated
        if (
          addon.addon.author !== request.user.sub &&
          !request.user.scopes.includes('system.analytics')
        ) {
          return reply.code(403).send({
            error: 'access_denied',
            message:
              'You do not have permission to view analytics for this addon',
          });
        }

        const timeRange = {
          start: request.query.start
            ? new Date(request.query.start)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: request.query.end ? new Date(request.query.end) : new Date(),
        };

        const analytics = await analyticsService.getAddonAnalytics(
          request.params.id,
          timeRange,
        );
        return reply.send(analytics);
      } catch (error) {
        return reply.code(500).send({
          error: 'analytics_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/marketplace/addons/:id/license
   * Get user license for addon
   */
  app.get<{
    Params: { id: string };
  }>(
    '/api/marketplace/addons/:id/license',
    {
      preHandler: requireAuth({ authMiddleware }),
    },
    async (request, reply) => {
      try {
        const license = await licensingService.getUserLicense(
          request.params.id,
          request.user.sub,
        );

        return reply.send({ license });
      } catch (error) {
        return reply.code(500).send({
          error: 'license_fetch_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/marketplace/addons/:id/license/tiers
   * Get available license tiers for addon
   */
  app.get<{
    Params: { id: string };
  }>('/api/marketplace/addons/:id/license/tiers', async (request, reply) => {
    try {
      const tiers = await licensingService.getLicenseTiers(request.params.id);
      return reply.send({ tiers });
    } catch (error) {
      return reply.code(500).send({
        error: 'tiers_fetch_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/marketplace/addons/:id/license
   * Purchase or create license for addon
   */
  app.post<{
    Params: { id: string };
    Body: {
      tierType: string;
      paymentMethodId?: string;
    };
  }>(
    '/api/marketplace/addons/:id/license',
    {
      preHandler: requireAuth({ authMiddleware }),
    },
    async (request, reply) => {
      try {
        const { tierType, paymentMethodId } = request.body;
        const tiers = await licensingService.getLicenseTiers(request.params.id);
        const tier = tiers.find((t) => t.type === tierType);

        if (!tier) {
          return reply.code(400).send({
            error: 'invalid_tier',
            message: 'Invalid license tier',
          });
        }

        let license;

        if (tier.price === 0) {
          // Free license - create immediately
          license = await licensingService.createLicense(
            request.params.id,
            request.user.sub,
            tierType,
          );
        } else {
          // Paid license - process payment first
          // This would integrate with a payment processor
          return reply.code(501).send({
            error: 'payment_not_implemented',
            message: 'Payment processing not yet implemented',
          });
        }

        return reply.send({ license });
      } catch (error) {
        return reply.code(500).send({
          error: 'license_creation_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );
};
```

## Success Criteria

Phase 5 is complete when:

1. ✅ **Marketplace**: Full addon marketplace with search, categories, and discovery
2. ✅ **Version Management**: Semantic versioning, compatibility checking, and updates
3. ✅ **Dependency Resolution**: Automatic dependency management and conflict detection
4. ✅ **Analytics Dashboard**: Comprehensive usage analytics and insights
5. ✅ **Monetization**: Licensing system with multiple tiers and payment integration
6. ✅ **Scalability**: Distributed architecture supporting high addon volumes
7. ✅ **Developer Tools**: Publishing workflow and analytics for addon creators

## Final System Summary

After completing all 5 phases, the OpenAidy addon system provides:

- **Complete Backend Foundation**: Secure, scalable addon infrastructure
- **Modern Frontend Integration**: Dynamic loading with seamless UI integration
- **Enterprise-Grade Security**: Comprehensive permission system and isolation
- **Excellent Developer Experience**: CLI tools, templates, and documentation
- **Thriving Ecosystem**: Marketplace, analytics, and monetization support

The addon system transforms OpenAidy into an extensible platform where third-party developers can create valuable extensions while maintaining security, performance, and user experience standards.

## Next Steps

Post-implementation recommendations:

- Launch beta program with selected addon developers
- Gather feedback and iterate on developer experience
- Scale infrastructure based on adoption patterns
- Expand marketplace features based on user needs
- Consider mobile addon support and cross-platform compatibility
