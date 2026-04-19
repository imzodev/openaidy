/**
 * Addon Loader System
 *
 * Handles dynamic loading, lifecycle management, and component registration for addons.
 */

import type { AddonManifest } from '@openaidy/shared-types';
import type { LoadedAddon, AddonRoute, AddonLoaderEvents } from './addon-types';

// ============================================================================
// Errors
// ============================================================================

/**
 * Addon loading error
 */
export class AddonLoadError extends Error {
  public readonly addonId: string;
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(message: string, addonId: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'AddonLoadError';
    this.addonId = addonId;
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Error codes
 */
export const AddonLoadErrorCodes = {
  MANIFEST_INVALID: 'MANIFEST_INVALID',
  MODULE_LOAD_FAILED: 'MODULE_LOAD_FAILED',
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  ADDON_NOT_FOUND: 'ADDON_NOT_FOUND',
  ADDON_ALREADY_LOADED: 'ADDON_ALREADY_LOADED',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

// ============================================================================
// Addon Loader
// ============================================================================

/**
 * Addon Loader
 *
 * Manages addon loading, unloading, and lifecycle.
 */
export class AddonLoader {
  private addons: Map<string, LoadedAddon> = new Map();
  private events: AddonLoaderEvents;
  private baseUrl: string;
  private apiBaseUrl: string;
  private loadListeners: Array<() => void> = [];

  constructor(options: {
    baseUrl: string;
    apiBaseUrl?: string;
    events?: AddonLoaderEvents;
  }) {
    this.baseUrl = options.baseUrl;
    this.apiBaseUrl = options.apiBaseUrl ?? options.baseUrl;
    this.events = options.events ?? {};
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Load all enabled addons from the backend
   */
  async loadEnabledAddons(): Promise<LoadedAddon[]> {
    this.events.onLoadStart?.('all');

    const loadedAddons: LoadedAddon[] = [];

    try {
      // Fetch addon list from backend
      const response = await fetch(
        `${this.apiBaseUrl}/api/addons?status=enabled`,
        {
          headers: this.getAuthHeaders(),
        },
      );

      if (!response.ok) {
        throw new AddonLoadError(
          'Failed to fetch addons',
          'all',
          AddonLoadErrorCodes.NETWORK_ERROR,
        );
      }

      const data = (await response.json()) as { addons?: APIAddon[] };
      const addons: APIAddon[] = data.addons ?? [];

      // Load each enabled addon
      for (const addon of addons) {
        try {
          const loaded = await this.loadAddon(addon);
          loadedAddons.push(loaded);
        } catch (error) {
          console.error(`Failed to load addon ${addon.addonId}:`, error);
        }
      }

      return loadedAddons;
    } finally {
      if (loadedAddons.length > 0) {
        this.events.onLoadComplete?.(loadedAddons[0]);
      }
    }
  }

  /**
   * Load a single addon
   */
  async loadAddon(addon: APIAddon): Promise<LoadedAddon> {
    const { addonId } = addon;

    // Check if already loaded
    if (this.addons.has(addonId)) {
      throw new AddonLoadError(
        `Addon ${addonId} is already loaded`,
        addonId,
        AddonLoadErrorCodes.ADDON_ALREADY_LOADED,
      );
    }

    this.events.onLoadStart?.(addonId);

    // Create the loaded addon structure
    const manifest = addon.manifest as unknown as AddonManifest;
    const loadedAddon: LoadedAddon = {
      id: addonId,
      manifest,
      status: 'loading',
      loadedAt: new Date(),
      components: {},
      routes: [],
    };

    try {
      // Load components if defined
      if (manifest.ui?.routes) {
        await this.loadComponents(loadedAddon, manifest);
      }

      // Set routes
      if (manifest.ui?.routes) {
        loadedAddon.routes = manifest.ui.routes.map((route) => ({
          path: route.path,
          component: () => this.loadComponent(loadedAddon, route.component),
        }));
      }

      loadedAddon.status = 'loaded';

      // Store the addon
      this.addons.set(addonId, loadedAddon);

      // Emit events
      this.events.onLoadComplete?.(loadedAddon);
      this.notifyListeners();

      return loadedAddon;
    } catch (error) {
      loadedAddon.status = 'error';
      this.events.onLoadError?.(addonId, error as Error);
      throw error;
    }
  }

  /**
   * Unload an addon
   */
  unloadAddon(addonId: string): void {
    const addon = this.addons.get(addonId);
    if (!addon) {
      return;
    }

    // Cleanup components
    for (const _component of Object.values(addon.components)) {
      // In a real implementation, we would cleanup component resources here
    }

    // Remove from map
    this.addons.delete(addonId);

    // Emit events
    this.events.onUnload?.(addonId);
    this.notifyListeners();
  }

  /**
   * Get a loaded addon by ID
   */
  getAddon(addonId: string): LoadedAddon | undefined {
    return this.addons.get(addonId);
  }

  /**
   * Get all loaded addons
   */
  getAllAddons(): LoadedAddon[] {
    return Array.from(this.addons.values());
  }

  /**
   * Get all routes from loaded addons
   */
  getAddonRoutes(): AddonRoute[] {
    const routes: AddonRoute[] = [];
    for (const addon of this.addons.values()) {
      routes.push(...addon.routes);
    }
    return routes;
  }

  /**
   * Get sidebar navigation items from all addons
   */
  getSidebarItems(): SidebarItem[] {
    const items: SidebarItem[] = [];

    for (const addon of this.addons.values()) {
      const manifest = addon.manifest;
      if (manifest.ui?.sidebar) {
        items.push({
          addonId: addon.id,
          icon: manifest.ui.sidebar.icon,
          label: manifest.ui.sidebar.label,
          order: manifest.ui.sidebar.order ?? 100,
          path: `/addons/${addon.id}`,
        });
      }
    }

    // Sort by order
    items.sort((a, b) => a.order - b.order);
    return items;
  }

  /**
   * Enable an addon (after admin approval)
   */
  async enableAddon(
    addonId: string,
    approvedPermissions: string[],
  ): Promise<LoadedAddon> {
    const response = await fetch(
      `${this.apiBaseUrl}/api/addons/${addonId}/enable`,
      {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvedPermissions }),
      },
    );

    if (!response.ok) {
      throw new AddonLoadError(
        `Failed to enable addon ${addonId}`,
        addonId,
        AddonLoadErrorCodes.PERMISSION_DENIED,
      );
    }

    const data = (await response.json()) as { accessToken?: string };
    const addon = this.addons.get(addonId);

    if (!addon) {
      throw new AddonLoadError(
        `Addon ${addonId} not found`,
        addonId,
        AddonLoadErrorCodes.ADDON_NOT_FOUND,
      );
    }

    // Update with access token
    addon.accessToken = data.accessToken;
    addon.status = 'loaded';
    this.events.onEnable?.(addon);

    return addon;
  }

  /**
   * Disable an addon
   */
  async disableAddon(addonId: string): Promise<void> {
    const response = await fetch(
      `${this.apiBaseUrl}/api/addons/${addonId}/disable`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new AddonLoadError(
        `Failed to disable addon ${addonId}`,
        addonId,
        AddonLoadErrorCodes.NETWORK_ERROR,
      );
    }

    const addon = this.addons.get(addonId);
    if (addon) {
      addon.accessToken = undefined;
      addon.status = 'disabled';
    }

    this.events.onDisable?.(addonId);
  }

  /**
   * Subscribe to addon load changes
   */
  onChange(listener: () => void): () => void {
    this.loadListeners.push(listener);
    return () => {
      const index = this.loadListeners.indexOf(listener);
      if (index !== -1) {
        this.loadListeners.splice(index, 1);
      }
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Load components from an addon
   */
  private async loadComponents(
    addon: LoadedAddon,
    manifest: AddonManifest,
  ): Promise<void> {
    if (!manifest.ui?.routes) return;

    for (const route of manifest.ui.routes) {
      try {
        const module = await this.loadComponent(addon, route.component);
        addon.components[route.component] = {
          name: route.component,
          component: () => Promise.resolve(module),
        };
      } catch (error) {
        console.error(`Failed to load component ${route.component}:`, error);
      }
    }
  }

  /**
   * Load a single component module
   */
  private async loadComponent(
    addon: LoadedAddon,
    componentName: string,
  ): Promise<Record<string, unknown>> {
    try {
      // Build the component URL based on addon entry point
      const entryPoint = addon.manifest.entry;
      const baseUrl = this.getAddonBaseUrl(addon.id);

      // Dynamic import
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const module: any = await import(
        /* @vite-ignore */ `${baseUrl}/${entryPoint}`
      );

      // Return the named component or default
      return module[componentName] ?? module.default ?? {};
    } catch (error) {
      throw new AddonLoadError(
        `Failed to load component ${componentName}`,
        addon.id,
        AddonLoadErrorCodes.COMPONENT_NOT_FOUND,
        error,
      );
    }
  }

  /**
   * Get the base URL for an addon
   */
  private getAddonBaseUrl(addonId: string): string {
    // In production, addons would be loaded from CDN or local storage
    // For now, return a placeholder
    return `${this.baseUrl}/addons/${addonId}`;
  }

  /**
   * Get authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    const token = this.getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Get stored authentication token
   */
  private getStoredToken(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    return localStorage.getItem('openaidy_auth_token') ?? undefined;
  }

  /**
   * Notify listeners of changes
   */
  private notifyListeners(): void {
    for (const listener of this.loadListeners) {
      try {
        listener();
      } catch (error) {
        console.error('Error in addon change listener:', error);
      }
    }
  }
}

// ============================================================================
// Sidebar Item
// ============================================================================

/**
 * Sidebar navigation item from an addon
 */
export interface SidebarItem {
  /** The addon's unique identifier */
  addonId: string;
  /** Icon identifier */
  icon: string;
  /** Display label */
  label: string;
  /** Navigation order (lower = first) */
  order: number;
  /** URL path */
  path: string;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Addon from API
 */
interface APIAddon {
  id: string;
  addonId: string;
  name: string;
  version: string;
  manifest: unknown;
  status: string;
  permissions: string[];
  config: Record<string, unknown>;
}

// ============================================================================
// Singleton Factory
// ============================================================================

let globalLoader: AddonLoader | undefined;

/**
 * Get or create the global addon loader instance
 */
export function getAddonLoader(): AddonLoader {
  if (!globalLoader) {
    globalLoader = new AddonLoader({
      baseUrl: window.location.origin,
      apiBaseUrl: window.location.origin,
    });
  }
  return globalLoader;
}
