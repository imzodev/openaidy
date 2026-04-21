/**
 * Marketplace Service
 *
 * Core marketplace functionality for addon discovery, publishing,
 * and management.
 */

import { MarketplaceRepository, SearchOptions } from '@openaidy/db';
import type { MarketplaceAddon, AddonVersion, AddonReview } from '@openaidy/db';

export interface PublishAddonInput {
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
  manifest: Record<string, unknown>;
  version: string;
  minOpenaidyVersion?: string;
  maxOpenaidyVersion?: string;
}

export interface PublishVersionInput {
  addonId: string;
  version: string;
  changelog: string;
  manifest: Record<string, unknown>;
  minOpenaidyVersion: string;
  maxOpenaidyVersion: string;
  downloadUrl: string;
  fileSize: number;
  checksum: string;
  releaseNotes?: string;
}

export interface MarketplaceServiceConfig {
  repository: MarketplaceRepository;
}

export class MarketplaceService {
  constructor(private readonly repo: MarketplaceRepository) {}

  /**
   * Publish a new addon to the marketplace
   */
  async publishAddon(input: PublishAddonInput): Promise<MarketplaceAddon> {
    // Check if addon already exists
    const existing = await this.repo.findAddonByAddonId(input.addonId);
    if (existing) {
      throw new Error(`Addon ${input.addonId} already exists in marketplace`);
    }

    // Create the marketplace addon
    const createInput: Parameters<typeof this.repo.createAddon>[0] = {
      addonId: input.addonId,
      name: input.name,
      description: input.description,
      shortDescription: input.shortDescription,
      authorId: input.authorId,
      authorName: input.authorName,
      authorEmail: input.authorEmail,
      manifest: input.manifest,
      currentVersion: input.version,
    };

    // Only include optional properties if provided
    if (input.website) createInput.website = input.website;
    if (input.repository) createInput.repository = input.repository;
    if (input.license) createInput.license = input.license;
    if (input.categoryId !== undefined)
      createInput.categoryId = input.categoryId;
    if (input.tags) createInput.tags = input.tags;
    if (input.iconUrl) createInput.iconUrl = input.iconUrl;

    const addon = await this.repo.createAddon(createInput);

    // Create initial version
    await this.repo.createVersion({
      addonId: addon.addonId,
      version: input.version,
      changelog: 'Initial release',
      manifest: input.manifest,
      minOpenaidyVersion: input.minOpenaidyVersion || '1.0.0',
      maxOpenaidyVersion: input.maxOpenaidyVersion || '2.0.0',
      downloadUrl: `https://registry.openaidy.dev/addons/${addon.addonId}/${input.version}`,
      fileSize: 0,
      checksum: '',
      status: 'published',
      publishedAt: new Date(),
    });

    return addon;
  }

  /**
   * Update an existing marketplace addon
   */
  async updateAddon(
    addonId: string,
    updates: {
      name?: string;
      description?: string;
      shortDescription?: string;
      website?: string;
      repository?: string;
      license?: string;
      categoryId?: number;
      tags?: string[];
      iconUrl?: string;
    },
  ): Promise<MarketplaceAddon | null> {
    return this.repo.updateAddon(addonId, updates);
  }

  /**
   * Submit addon for review
   */
  async submitForReview(addonId: string): Promise<MarketplaceAddon | null> {
    return this.repo.updateAddon(addonId, { status: 'pending_review' });
  }

  /**
   * Approve addon
   */
  async approveAddon(addonId: string): Promise<MarketplaceAddon | null> {
    return this.repo.updateAddon(addonId, {
      status: 'published',
      publishedAt: new Date(),
    });
  }

  /**
   * Reject addon
   */
  async rejectAddon(addonId: string): Promise<MarketplaceAddon | null> {
    return this.repo.updateAddon(addonId, { status: 'rejected' });
  }

  /**
   * Publish a new version
   */
  async publishVersion(input: PublishVersionInput): Promise<AddonVersion> {
    const version = await this.repo.createVersion({
      addonId: input.addonId,
      version: input.version,
      changelog: input.changelog,
      manifest: input.manifest,
      minOpenaidyVersion: input.minOpenaidyVersion,
      maxOpenaidyVersion: input.maxOpenaidyVersion,
      downloadUrl: input.downloadUrl,
      fileSize: input.fileSize,
      checksum: input.checksum,
      releaseNotes: input.releaseNotes,
      status: 'published',
      publishedAt: new Date(),
    });

    // Update current version on addon
    await this.repo.updateAddon(input.addonId, {
      currentVersion: input.version,
    });

    return version;
  }

  /**
   * Search marketplace addons
   */
  async searchAddons(options: SearchOptions = {}): Promise<{
    addons: MarketplaceAddon[];
    total: number;
  }> {
    return this.repo.searchAddons({
      ...options,
      status: options.status || 'published',
    });
  }

  /**
   * Get addon by ID
   */
  async getAddon(addonId: string): Promise<MarketplaceAddon | null> {
    return this.repo.findAddonByAddonId(addonId);
  }

  /**
   * Get addon versions
   */
  async getVersions(addonId: string): Promise<AddonVersion[]> {
    return this.repo.getVersions(addonId);
  }

  /**
   * Get featured addons
   */
  async getFeatured(): Promise<MarketplaceAddon[]> {
    const result = await this.repo.searchAddons({
      featured: true,
      status: 'published',
      limit: 10,
    });
    return result.addons;
  }

  /**
   * Get addons by category
   */
  async getByCategory(categoryId: number): Promise<MarketplaceAddon[]> {
    const result = await this.repo.searchAddons({
      categoryId,
      status: 'published',
      limit: 50,
    });
    return result.addons;
  }

  /**
   * Get addons by author
   */
  async getByAuthor(authorId: string): Promise<MarketplaceAddon[]> {
    const result = await this.repo.searchAddons({
      authorId,
      limit: 50,
    });
    return result.addons;
  }

  /**
   * Record a download
   */
  async recordDownload(
    addonId: string,
    version: string,
    metadata?: {
      userId?: string;
      instanceId?: string;
      source?: string;
      country?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    await this.repo.recordDownload({
      addonId,
      version,
      userId: metadata?.userId,
      instanceId: metadata?.instanceId,
      source: metadata?.source || 'direct',
      country: metadata?.country,
      userAgent: metadata?.userAgent,
    });
  }

  /**
   * Get download stats
   */
  async getDownloadStats(addonId: string): Promise<{
    total: number;
    byVersion: Record<string, number>;
  }> {
    return this.repo.getDownloadStats(addonId);
  }

  /**
   * Add review
   */
  async addReview(
    addonId: string,
    userId: string,
    userName: string,
    rating: number,
    title: string,
    content: string,
    pros?: string[],
    cons?: string[],
  ): Promise<AddonReview> {
    const review = await this.repo.createReview({
      addonId,
      userId,
      userName,
      rating,
      title,
      content,
      pros: pros || [],
      cons: cons || [],
      verified: false,
      helpful: 0,
      notHelpful: 0,
      status: 'active',
    });

    // Update addon rating
    await this.updateAddonRating(addonId);

    return review;
  }

  /**
   * Get reviews for addon
   */
  async getReviews(
    addonId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ reviews: AddonReview[]; total: number }> {
    return this.repo.getReviews(addonId, options);
  }

  /**
   * Update addon rating based on reviews
   */
  private async updateAddonRating(addonId: string): Promise<void> {
    const { reviews } = await this.repo.getReviews(addonId, { limit: 1000 });

    if (reviews.length === 0) return;

    const avgRating =
      reviews.reduce(
        (sum: number, r: { rating: number }) => sum + r.rating,
        0,
      ) / reviews.length;

    await this.repo.updateAddon(addonId, {
      rating: avgRating.toFixed(2),
      reviewCount: reviews.length,
    });
  }

  /**
   * Get all categories
   */
  async getCategories() {
    return this.repo.getCategories();
  }

  /**
   * Create category
   */
  async createCategory(
    name: string,
    slug: string,
    icon: string,
    description?: string,
    parentId?: number,
  ) {
    return this.repo.createCategory({
      name,
      slug,
      description,
      icon,
      parentId,
      sortOrder: 0,
      active: true,
    });
  }

  /**
   * Add to favorites
   */
  async addFavorite(addonId: string, userId: string) {
    return this.repo.addFavorite(addonId, userId);
  }

  /**
   * Remove from favorites
   */
  async removeFavorite(addonId: string, userId: string) {
    return this.repo.removeFavorite(addonId, userId);
  }

  /**
   * Get user favorites
   */
  async getUserFavorites(userId: string) {
    return this.repo.getUserFavorites(userId);
  }

  /**
   * Deprecate addon
   */
  async deprecateAddon(addonId: string): Promise<MarketplaceAddon | null> {
    return this.repo.updateAddon(addonId, { status: 'deprecated' });
  }

  /**
   * Delete addon from marketplace
   */
  async deleteAddon(addonId: string): Promise<boolean> {
    return this.repo.deleteAddon(addonId);
  }
}
