/**
 * Marketplace Repository
 *
 * Data access layer for marketplace operations.
 */

import { eq, desc, and, like, sql, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/marketplace';

type Database = DatabaseClient;

export interface CreateMarketplaceAddonInput {
  addonId: string;
  name: string;
  description: string;
  shortDescription: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  website?: string;
  repository?: string;
  license?: string;
  categoryId?: number;
  tags?: string[];
  iconUrl?: string;
  bannerUrl?: string;
  screenshots?: string[];
  manifest: Record<string, unknown>;
  currentVersion: string;
}

export interface UpdateMarketplaceAddonInput {
  name?: string;
  description?: string;
  shortDescription?: string;
  website?: string;
  repository?: string;
  license?: string;
  status?: schema.MarketplaceStatus;
  categoryId?: number;
  tags?: string[];
  iconUrl?: string;
  bannerUrl?: string;
  screenshots?: string[];
  currentVersion?: string;
  rating?: string;
  reviewCount?: number;
  featured?: boolean;
  publishedAt?: Date;
}

export interface SearchOptions {
  query?: string;
  categoryId?: number;
  tags?: string[];
  status?: schema.MarketplaceStatus;
  authorId?: string;
  featured?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'downloads' | 'rating' | 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export class MarketplaceRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a marketplace addon
   */
  async createAddon(
    input: CreateMarketplaceAddonInput,
  ): Promise<schema.MarketplaceAddon> {
    const [row] = await this.db
      .insert(schema.marketplaceAddons)
      .values({
        id: nanoid(),
        addonId: input.addonId,
        name: input.name,
        description: input.description,
        shortDescription: input.shortDescription,
        authorId: input.authorId,
        authorName: input.authorName,
        authorEmail: input.authorEmail,
        website: input.website,
        repository: input.repository,
        license: input.license ?? 'MIT',
        status: 'draft',
        categoryId: input.categoryId,
        tags: input.tags ?? [],
        iconUrl: input.iconUrl,
        bannerUrl: input.bannerUrl,
        screenshots: input.screenshots ?? [],
        manifest: input.manifest,
        currentVersion: input.currentVersion,
        downloads: 0,
        rating: '0.00',
        reviewCount: 0,
        featured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  /**
   * Find addon by ID
   */
  async findAddonById(id: string): Promise<schema.MarketplaceAddon | null> {
    const results = await this.db
      .select()
      .from(schema.marketplaceAddons)
      .where(eq(schema.marketplaceAddons.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * Find addon by addon ID
   */
  async findAddonByAddonId(
    addonId: string,
  ): Promise<schema.MarketplaceAddon | null> {
    const results = await this.db
      .select()
      .from(schema.marketplaceAddons)
      .where(eq(schema.marketplaceAddons.addonId, addonId))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * Search marketplace addons
   */
  async searchAddons(
    options: SearchOptions = {},
  ): Promise<{ addons: schema.MarketplaceAddon[]; total: number }> {
    const conditions = [];

    if (options.status) {
      conditions.push(eq(schema.marketplaceAddons.status, options.status));
    } else {
      // Default to published only
      conditions.push(eq(schema.marketplaceAddons.status, 'published'));
    }

    if (options.query) {
      conditions.push(
        like(schema.marketplaceAddons.name, `%${options.query}%`),
      );
    }

    if (options.categoryId) {
      conditions.push(
        eq(schema.marketplaceAddons.categoryId, options.categoryId),
      );
    }

    if (options.authorId) {
      conditions.push(eq(schema.marketplaceAddons.authorId, options.authorId));
    }

    if (options.featured !== undefined) {
      conditions.push(eq(schema.marketplaceAddons.featured, options.featured));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Sorting
    const sortColumn = options.sortBy
      ? schema.marketplaceAddons[options.sortBy]
      : schema.marketplaceAddons.downloads;
    const sortDir = options.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;

    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const addons = await this.db
      .select()
      .from(schema.marketplaceAddons)
      .where(whereClause)
      .orderBy(sortDir === sql`ASC` ? sortColumn : sql`${sortColumn} DESC`)
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await this.db
      .select({ count: count() })
      .from(schema.marketplaceAddons)
      .where(whereClause);

    return {
      addons,
      total: countResult[0]?.count ?? 0,
    };
  }

  /**
   * Update marketplace addon
   */
  async updateAddon(
    id: string,
    input: UpdateMarketplaceAddonInput,
  ): Promise<schema.MarketplaceAddon | null> {
    const [row] = await this.db
      .update(schema.marketplaceAddons)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.marketplaceAddons.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Delete marketplace addon
   */
  async deleteAddon(id: string): Promise<boolean> {
    await this.db
      .delete(schema.marketplaceAddons)
      .where(eq(schema.marketplaceAddons.id, id));
    return true;
  }

  /**
   * Create addon version
   */
  async createVersion(
    input: Omit<schema.NewAddonVersion, 'id' | 'createdAt'>,
  ): Promise<schema.AddonVersion> {
    const [row] = await this.db
      .insert(schema.addonVersions)
      .values({
        id: nanoid(),
        ...input,
        createdAt: new Date(),
      })
      .returning();
    return row!;
  }

  /**
   * Get addon versions
   */
  async getVersions(addonId: string): Promise<schema.AddonVersion[]> {
    return this.db
      .select()
      .from(schema.addonVersions)
      .where(eq(schema.addonVersions.addonId, addonId))
      .orderBy(desc(schema.addonVersions.createdAt));
  }

  /**
   * Create review
   */
  async createReview(
    input: Omit<schema.NewAddonReview, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<schema.AddonReview> {
    const [row] = await this.db
      .insert(schema.addonReviews)
      .values({
        id: nanoid(),
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  /**
   * Get addon reviews
   */
  async getReviews(
    addonId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ reviews: schema.AddonReview[]; total: number }> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const reviews = await this.db
      .select()
      .from(schema.addonReviews)
      .where(
        and(
          eq(schema.addonReviews.addonId, addonId),
          eq(schema.addonReviews.status, 'active'),
        ),
      )
      .orderBy(desc(schema.addonReviews.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await this.db
      .select({ count: count() })
      .from(schema.addonReviews)
      .where(
        and(
          eq(schema.addonReviews.addonId, addonId),
          eq(schema.addonReviews.status, 'active'),
        ),
      );

    return {
      reviews,
      total: countResult[0]?.count ?? 0,
    };
  }

  /**
   * Record download
   */
  async recordDownload(
    input: Omit<schema.NewAddonDownload, 'id' | 'downloadedAt'>,
  ): Promise<schema.AddonDownload> {
    const [row] = await this.db
      .insert(schema.addonDownloads)
      .values({
        id: nanoid(),
        ...input,
        downloadedAt: new Date(),
      })
      .returning();
    return row!;
  }

  /**
   * Get download stats for addon
   */
  async getDownloadStats(
    addonId: string,
  ): Promise<{ total: number; byVersion: Record<string, number> }> {
    const downloads = await this.db
      .select()
      .from(schema.addonDownloads)
      .where(eq(schema.addonDownloads.addonId, addonId));

    const byVersion: Record<string, number> = {};
    let total = 0;

    for (const download of downloads) {
      total++;
      byVersion[download.version] = (byVersion[download.version] ?? 0) + 1;
    }

    return { total, byVersion };
  }

  /**
   * Create category
   */
  async createCategory(
    input: Omit<schema.NewAddonCategory, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<schema.AddonCategory> {
    const [row] = await this.db
      .insert(schema.addonCategories)
      .values({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<schema.AddonCategory[]> {
    return this.db
      .select()
      .from(schema.addonCategories)
      .where(eq(schema.addonCategories.active, true))
      .orderBy(schema.addonCategories.sortOrder);
  }

  /**
   * Add to favorites
   */
  async addFavorite(
    addonId: string,
    userId: string,
  ): Promise<schema.AddonFavorite> {
    const [row] = await this.db
      .insert(schema.addonFavorites)
      .values({
        id: nanoid(),
        addonId,
        userId,
        createdAt: new Date(),
      })
      .returning();
    return row!;
  }

  /**
   * Remove from favorites
   */
  async removeFavorite(addonId: string, userId: string): Promise<boolean> {
    await this.db
      .delete(schema.addonFavorites)
      .where(
        and(
          eq(schema.addonFavorites.addonId, addonId),
          eq(schema.addonFavorites.userId, userId),
        ),
      );
    return true;
  }

  /**
   * Get user favorites
   */
  async getUserFavorites(userId: string): Promise<schema.AddonFavorite[]> {
    return this.db
      .select()
      .from(schema.addonFavorites)
      .where(eq(schema.addonFavorites.userId, userId))
      .orderBy(desc(schema.addonFavorites.createdAt));
  }
}
