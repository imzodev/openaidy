/**
 * Addon Router Integration
 *
 * Dynamic route registration and navigation for addon-based pages.
 */

import { createSignal, onMount, onCleanup } from 'solid-js';
import type { AddonRoute } from './addon-types';
import { getAddonLoader, type SidebarItem } from './addon-loader';

// ============================================================================
// Route Registry
// ============================================================================

/**
 * Registry for addon routes
 */
class AddonRouteRegistry {
  private routes: Map<string, AddonRoute> = new Map();
  private listeners: Set<() => void> = new Set();

  /**
   * Register addon routes
   */
  register(addonId: string, routes: AddonRoute[]): void {
    for (const route of routes) {
      // Prefix route with addon ID to avoid collisions
      const fullPath = `/addons/${addonId}${route.path}`;
      this.routes.set(fullPath, route);
    }
    this.notifyListeners();
  }

  /**
   * Unregister addon routes
   */
  unregister(addonId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.routes.keys()) {
      if (key.startsWith(`/addons/${addonId}`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.routes.delete(key);
    }
    this.notifyListeners();
  }

  /**
   * Get all registered routes
   */
  getAllRoutes(): Array<{ path: string; route: AddonRoute }> {
    return Array.from(this.routes.entries()).map(([path, route]) => ({
      path,
      route,
    }));
  }

  /**
   * Get route by path
   */
  getRoute(path: string): AddonRoute | undefined {
    return this.routes.get(path);
  }

  /**
   * Check if path matches any addon route
   */
  matchesAddonRoute(path: string): boolean {
    return this.routes.has(path);
  }

  /**
   * Subscribe to route changes
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// Global registry instance
const globalRegistry = new AddonRouteRegistry();

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access addon route registry
 */
export function useAddonRoutes() {
  return {
    registry: globalRegistry,

    /**
     * Register routes from a loaded addon
     */
    registerRoutes: (addonId: string, routes: AddonRoute[]) => {
      globalRegistry.register(addonId, routes);
    },

    /**
     * Unregister routes for an addon
     */
    unregisterRoutes: (addonId: string) => {
      globalRegistry.unregister(addonId);
    },

    /**
     * Get all addon routes
     */
    getAllRoutes: () => globalRegistry.getAllRoutes(),

    /**
     * Get route by path
     */
    getRoute: (path: string) => globalRegistry.getRoute(path),

    /**
     * Check if path matches addon route
     */
    isAddonRoute: (path: string) => globalRegistry.matchesAddonRoute(path),
  };
}

// ============================================================================
// Addon Router
// ============================================================================

/**
 * Addon router state
 */
interface AddonRouterState {
  /** Current addon route path */
  currentAddonPath: string | null;
  /** The matched addon route */
  currentRoute: AddonRoute | null;
  /** The addon ID that owns the current route */
  currentAddonId: string | null;
}

/**
 * Custom hook for addon routing
 *
 * Integrates addon dynamic routes with the main router.
 * Handles navigation and route matching for addon pages.
 */
export function createAddonRouter() {
  const [state, setState] = createSignal<AddonRouterState>({
    currentAddonPath: null,
    currentRoute: null,
    currentAddonId: null,
  });

  // Handle path changes
  const handlePathChange = () => {
    const path = window.location.pathname;

    // Check if this is an addon route
    if (!path.startsWith('/addons/')) {
      setState({
        currentAddonPath: null,
        currentRoute: null,
        currentAddonId: null,
      });
      return;
    }

    const route = globalRegistry.getRoute(path);
    if (route) {
      // Extract addon ID from path
      const match = path.match(/^\/addons\/([^/]+)/);
      const addonId = match ? match[1] : null;

      setState({
        currentAddonPath: path,
        currentRoute: route,
        currentAddonId: addonId,
      });
    } else {
      // No matching route found
      setState({
        currentAddonPath: path,
        currentRoute: null,
        currentAddonId: null,
      });
    }
  };

  // Set up popstate listener
  onMount(() => {
    // Initial check
    handlePathChange();

    // Listen for route changes
    const unsubscribeRegistry = globalRegistry.onChange(handlePathChange);

    // Listen for popstate events
    const handlePop = () => handlePathChange();
    window.addEventListener('popstate', handlePop);

    // Listen for navigation
    const handleNavigate = () => handlePathChange();
    window.addEventListener('addon:navigate', handleNavigate);

    onCleanup(() => {
      unsubscribeRegistry();
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('addon:navigate', handleNavigate);
    });
  });

  return {
    state,

    /**
     * Navigate to an addon route
     */
    navigate: (path: string) => {
      window.history.pushState({}, '', path);
      handlePathChange();
      // Dispatch custom event for other listeners
      window.dispatchEvent(
        new CustomEvent('addon:navigate', { detail: { path } }),
      );
    },

    /**
     * Get the component for the current route
     */
    getCurrentComponent: async () => {
      const s = state();
      if (!s.currentRoute) return null;

      try {
        const module = await s.currentRoute.component();
        return module.default || module;
      } catch (error) {
        console.error('Failed to load addon component:', error);
        return null;
      }
    },
  };
}

// ============================================================================
// Navigation
// ============================================================================

/**
 * Navigate to an addon page
 */
export function navigateToAddon(addonId: string, path: string = '/'): void {
  const fullPath = `/addons/${addonId}${path}`;
  window.history.pushState({}, '', fullPath);
  window.dispatchEvent(
    new CustomEvent('addon:navigate', { detail: { path: fullPath } }),
  );
}

/**
 * Navigate to an addon's main page
 */
export function navigateToAddonHome(addonId: string): void {
  navigateToAddon(addonId, '/');
}

// ============================================================================
// Sidebar Integration
// ============================================================================

/**
 * Get sidebar items from addon loader
 */
export function getAddonSidebarItems(): SidebarItem[] {
  try {
    const loader = getAddonLoader();
    return loader.getSidebarItems();
  } catch {
    return [];
  }
}

/**
 * Get full sidebar navigation including addon items
 */
export function getFullSidebarItems(): Array<{
  addon?: SidebarItem;
  isAddon: boolean;
}> {
  const addonItems = getAddonSidebarItems();

  return addonItems.map((item) => ({
    addon: item,
    isAddon: true,
  }));
}

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Match a path to an addon route
 */
export function matchAddonRoute(
  path: string,
): { addonId: string; routePath: string; route: AddonRoute } | null {
  // Try exact match first
  const route = globalRegistry.getRoute(path);
  if (route) {
    const match = path.match(/^\/addons\/([^/]+)(.*)/);
    if (match) {
      return {
        addonId: match[1]!,
        routePath: match[2] || '/',
        route,
      };
    }
  }

  return null;
}

/**
 * Check if current path is an addon route
 */
export function isCurrentPathAddonRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return globalRegistry.matchesAddonRoute(window.location.pathname);
}

/**
 * Get current addon context
 */
export function getCurrentAddonContext(): {
  addonId: string | null;
  route: AddonRoute | null;
  path: string | null;
} {
  if (typeof window === 'undefined') {
    return { addonId: null, route: null, path: null };
  }

  const path = window.location.pathname;

  if (!path.startsWith('/addons/')) {
    return { addonId: null, route: null, path: null };
  }

  const route = globalRegistry.getRoute(path);
  const match = path.match(/^\/addons\/([^/]+)/);
  const addonId = match ? match[1] : null;

  return { addonId, route: route ?? null, path };
}

// ============================================================================
// Exports
// ============================================================================

export { globalRegistry as addonRouteRegistry };
export type { AddonRoute };
