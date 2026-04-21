/**
 * Marketplace Component
 *
 * Main marketplace interface for browsing and discovering addons.
 */

import { createSignal, createResource, Show, For } from 'solid-js';

export interface MarketplaceAddon {
  id: string;
  addonId: string;
  name: string;
  description: string;
  shortDescription: string;
  authorName: string;
  currentVersion: string;
  downloads: number;
  rating: string;
  reviewCount: number;
  iconUrl?: string;
  featured: boolean;
  tags: string[];
  categoryId?: number;
  publishedAt?: string;
}

export interface MarketplaceCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  description?: string;
}

interface MarketplaceProps {
  onAddonSelect?: (addon: MarketplaceAddon) => void;
  onInstallAddon?: (addonId: string) => void;
}

/**
 * Main Marketplace component
 */
export function Marketplace(props: MarketplaceProps) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedCategory, setSelectedCategory] = createSignal<number | null>(
    null,
  );
  const [sortBy, setSortBy] = createSignal<
    'downloads' | 'rating' | 'createdAt' | 'name'
  >('downloads');

  const [addons] = createResource(
    () => ({
      q: searchQuery(),
      category: selectedCategory(),
      sort: sortBy(),
    }),
    async (params) => {
      const query = new URLSearchParams();
      if (params.q) query.set('q', params.q);
      if (params.category) query.set('category', String(params.category));
      query.set('sort', params.sort);

      const response = await fetch(`/api/marketplace/addons?${query}`);
      if (!response.ok) return { addons: [], total: 0 };
      return response.json();
    },
  );

  const [categories] = createResource(async () => {
    const response = await fetch('/api/marketplace/categories');
    if (!response.ok) return { categories: [] };
    return response.json();
  });

  const [featured] = createResource(async () => {
    const response = await fetch('/api/marketplace/addons/featured');
    if (!response.ok) return { addons: [] };
    return response.json();
  });

  return (
    <div class="marketplace-container">
      {/* Header */}
      <div class="marketplace-header">
        <h1 class="text-2xl font-bold">Addon Marketplace</h1>
        <p class="text-gray-600 dark:text-gray-400">
          Discover and install addons to extend OpenAidy
        </p>
      </div>

      {/* Search */}
      <div class="marketplace-search">
        <input
          type="search"
          placeholder="Search addons..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          class="search-input"
        />
      </div>

      {/* Categories */}
      <Show when={categories()?.categories}>
        <div class="marketplace-categories">
          <button
            class={`category-pill ${selectedCategory() === null ? 'active' : ''}`}
            onClick={() => setSelectedCategory(null)}
          >
            All
          </button>
          <For each={categories()?.categories}>
            {(category: MarketplaceCategory) => (
              <button
                class={`category-pill ${selectedCategory() === category.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category.id)}
              >
                <span class="category-icon">{category.icon}</span>
                {category.name}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Featured Section */}
      <Show when={featured()?.addons?.length > 0 && !searchQuery()}>
        <section class="featured-section">
          <h2 class="text-xl font-semibold mb-4">Featured Addons</h2>
          <div class="featured-grid">
            <For each={featured()?.addons}>
              {(addon: MarketplaceAddon) => (
                <AddonCard
                  addon={addon}
                  featured
                  onSelect={() => props.onAddonSelect?.(addon)}
                  onInstall={() => props.onInstallAddon?.(addon.addonId)}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* Sort Options */}
      <div class="sort-controls">
        <span class="text-sm text-gray-600 dark:text-gray-400">Sort by:</span>
        <select
          value={sortBy()}
          onChange={(e) =>
            setSortBy(
              e.currentTarget.value as
                | 'downloads'
                | 'rating'
                | 'createdAt'
                | 'name',
            )
          }
          class="sort-select"
        >
          <option value="downloads">Most Downloads</option>
          <option value="rating">Highest Rated</option>
          <option value="createdAt">Newest</option>
          <option value="name">Name</option>
        </select>
      </div>

      {/* Results */}
      <Show
        when={!addons.loading}
        fallback={<div class="loading">Loading addons...</div>}
      >
        <div class="addons-grid">
          <For each={addons()?.addons}>
            {(addon: MarketplaceAddon) => (
              <AddonCard
                addon={addon}
                onSelect={() => props.onAddonSelect?.(addon)}
                onInstall={() => props.onInstallAddon?.(addon.addonId)}
              />
            )}
          </For>
        </div>

        <Show when={addons()?.addons?.length === 0}>
          <div class="empty-state">
            <p>No addons found matching your criteria.</p>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * Addon Card Component
 */
interface AddonCardProps {
  addon: MarketplaceAddon;
  featured?: boolean;
  onSelect?: () => void;
  onInstall?: () => void;
}

export function AddonCard(props: AddonCardProps) {
  return (
    <div class={`addon-card ${props.featured ? 'addon-card-featured' : ''}`}>
      <div class="addon-card-header">
        <Show
          when={props.addon.iconUrl}
          fallback={
            <div class="addon-icon-placeholder">
              {props.addon.name.charAt(0)}
            </div>
          }
        >
          <img
            src={props.addon.iconUrl}
            alt={props.addon.name}
            class="addon-icon"
          />
        </Show>
        <Show when={props.addon.featured}>
          <span class="featured-badge">Featured</span>
        </Show>
      </div>

      <div class="addon-card-body">
        <h3 class="addon-name">{props.addon.name}</h3>
        <p class="addon-author">by {props.addon.authorName}</p>
        <p class="addon-description">{props.addon.shortDescription}</p>

        <div class="addon-meta">
          <span class="meta-item">
            <svg class="meta-icon" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fill-rule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10z"
                clip-rule="evenodd"
              />
            </svg>
            {Number(props.addon.rating).toFixed(1)}
          </span>
          <span class="meta-item">
            <svg class="meta-icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                clip-rule="evenodd"
              />
            </svg>
            {formatDownloads(props.addon.downloads)}
          </span>
        </div>

        <div class="addon-tags">
          <For each={props.addon.tags?.slice(0, 3)}>
            {(tag: string) => <span class="tag">{tag}</span>}
          </For>
        </div>
      </div>

      <div class="addon-card-footer">
        <button class="btn-secondary" onClick={props.onSelect}>
          View Details
        </button>
        <button class="btn-primary" onClick={props.onInstall}>
          Install
        </button>
      </div>
    </div>
  );
}

/**
 * Format download count
 */
function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

export default Marketplace;
