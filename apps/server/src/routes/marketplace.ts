/**
 * Marketplace API Routes
 *
 * REST API endpoints for marketplace operations including
 * addon search, publishing, reviews, and analytics.
 */

import type { FastifyPluginAsync } from 'fastify';
import { MarketplaceService } from '../marketplace/service';
import type { MarketplaceRepository } from '@openaidy/db';

/**
 * Marketplace routes options
 */
export interface MarketplaceRoutesOptions {
  marketplaceRepository: MarketplaceRepository;
  authMiddleware: unknown;
  jwtSecret: string;
}

/**
 * Search query parameters
 */
interface SearchQuery {
  q?: string;
  category?: string;
  tags?: string;
  featured?: string;
  author?: string;
  limit?: string;
  offset?: string;
  sort?: 'downloads' | 'rating' | 'createdAt' | 'name';
  order?: 'asc' | 'desc';
}

/**
 * Add review request body
 */
interface AddReviewBody {
  addonId: string;
  rating: number;
  title: string;
  content: string;
  pros?: string[];
  cons?: string[];
}

/**
 * Publish addon request body
 */
interface PublishAddonBody {
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

/**
 * Marketplace routes plugin
 */
export const marketplaceRoutes: FastifyPluginAsync<
  MarketplaceRoutesOptions
> = async (app, opts) => {
  // Create marketplace service
  const marketplaceService = new MarketplaceService(opts.marketplaceRepository);

  // GET /api/marketplace/categories - Get all categories
  app.get('/api/marketplace/categories', async () => {
    const categories = await marketplaceService.getCategories();
    return { categories };
  });

  // GET /api/marketplace/addons - Search marketplace addons
  app.get<{ Querystring: SearchQuery }>(
    '/api/marketplace/addons',
    async (request) => {
      const {
        q,
        category,
        tags,
        featured,
        author,
        limit,
        offset,
        sort,
        order,
      } = request.query;

      const searchOptions: {
        query?: string;
        categoryId?: number;
        tags?: string[];
        featured?: boolean;
        authorId?: string;
        limit?: number;
        offset?: number;
        sortBy?: 'downloads' | 'rating' | 'createdAt' | 'name';
        sortOrder?: 'asc' | 'desc';
      } = {};

      if (q) searchOptions.query = q;
      if (category) searchOptions.categoryId = parseInt(category, 10);
      if (tags) searchOptions.tags = tags.split(',');
      if (featured === 'true') searchOptions.featured = true;
      if (author) searchOptions.authorId = author;
      if (limit) searchOptions.limit = parseInt(limit, 10);
      if (offset) searchOptions.offset = parseInt(offset, 10);
      if (sort)
        searchOptions.sortBy = sort as
          | 'downloads'
          | 'rating'
          | 'createdAt'
          | 'name';
      if (order) searchOptions.sortOrder = order;

      const result = await marketplaceService.searchAddons(searchOptions);
      return {
        addons: result.addons,
        total: result.total,
      };
    },
  );

  // GET /api/marketplace/addons/featured - Get featured addons
  app.get('/api/marketplace/addons/featured', async () => {
    const addons = await marketplaceService.getFeatured();
    return { addons };
  });

  // GET /api/marketplace/addons/:id - Get addon details
  app.get<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id',
    async (request) => {
      const addon = await marketplaceService.getAddon(request.params.id);
      if (!addon) {
        return { error: 'not_found', message: 'Addon not found' };
      }
      return { addon };
    },
  );

  // GET /api/marketplace/addons/:id/versions - Get addon versions
  app.get<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id/versions',
    async (request) => {
      const versions = await marketplaceService.getVersions(request.params.id);
      return { versions };
    },
  );

  // GET /api/marketplace/addons/:id/reviews - Get addon reviews
  app.get<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id/reviews',
    async (request) => {
      const result = await marketplaceService.getReviews(request.params.id);
      return result;
    },
  );

  // POST /api/marketplace/reviews - Add a review
  app.post<{ Body: AddReviewBody }>(
    '/api/marketplace/reviews',
    {
      preHandler: async (_request, _reply) => {
        // In real implementation, require auth here
      },
    },
    async (_request) => {
      const { addonId, rating, title, content, pros, cons } = _request.body;

      // In real implementation, get user info from auth
      const userId = 'anonymous';
      const userName = 'Anonymous User';

      const review = await marketplaceService.addReview(
        addonId,
        userId,
        userName,
        rating,
        title,
        content,
        pros,
        cons,
      );

      return { review };
    },
  );

  // POST /api/marketplace/addons - Publish new addon
  app.post<{ Body: PublishAddonBody }>(
    '/api/marketplace/addons',
    {
      preHandler: async (_request, _reply) => {
        // In real implementation, require auth here
      },
    },
    async (_request) => {
      try {
        const addon = await marketplaceService.publishAddon(_request.body);
        return { addon };
      } catch (error) {
        return {
          error: 'publish_failed',
          message:
            error instanceof Error ? error.message : 'Failed to publish addon',
        };
      }
    },
  );

  // POST /api/marketplace/addons/:id/download - Record download
  app.post<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id/download',
    async (request, reply) => {
      const addon = await marketplaceService.getAddon(request.params.id);
      if (!addon) {
        return reply
          .status(404)
          .send({ error: 'not_found', message: 'Addon not found' });
      }

      // Record download
      const downloadMetadata: {
        source: string;
        userAgent?: string;
      } = {
        source: 'web',
      };
      const userAgent = request.headers['user-agent'];
      if (userAgent) downloadMetadata.userAgent = userAgent;

      await marketplaceService.recordDownload(
        addon.addonId,
        addon.currentVersion,
        downloadMetadata,
      );

      return {
        success: true,
        downloadUrl: `/api/marketplace/addons/${addon.addonId}/files/${addon.currentVersion}`,
      };
    },
  );

  // GET /api/marketplace/addons/:id/analytics - Get addon analytics
  app.get<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id/analytics',
    async (request) => {
      const stats = await marketplaceService.getDownloadStats(
        request.params.id,
      );
      return stats;
    },
  );

  // GET /api/marketplace/analytics - Get marketplace analytics
  app.get('/api/marketplace/analytics', async () => {
    // In real implementation, aggregate stats from database
    return {
      totalAddons: 0,
      totalDownloads: 0,
      totalReviews: 0,
      averageRating: 0,
    };
  });

  // POST /api/marketplace/addons/:id/favorite - Add to favorites
  app.post<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id/favorite',
    async (request) => {
      // In real implementation, get user from auth
      const userId = 'anonymous';
      await marketplaceService.addFavorite(request.params.id, userId);
      return { success: true };
    },
  );

  // DELETE /api/marketplace/addons/:id/favorite - Remove from favorites
  app.delete<{ Params: { id: string } }>(
    '/api/marketplace/addons/:id/favorite',
    async (request) => {
      // In real implementation, get user from auth
      const userId = 'anonymous';
      await marketplaceService.removeFavorite(request.params.id, userId);
      return { success: true };
    },
  );

  // GET /api/marketplace/users/:id/favorites - Get user favorites
  app.get<{ Params: { id: string } }>(
    '/api/marketplace/users/:id/favorites',
    async (request) => {
      const favorites = await marketplaceService.getUserFavorites(
        request.params.id,
      );
      return { favorites };
    },
  );
};
