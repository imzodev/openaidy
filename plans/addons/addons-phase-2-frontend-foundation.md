# Phase 2: Frontend Foundation - Addons Implementation

## Overview

Phase 2 builds the frontend infrastructure that enables addons to be dynamically loaded, displayed in the UI, and interact with OpenAidy's backend systems. This phase focuses on creating the client-side addon loader, runtime API, and management interface.

## Objectives

- Implement addon loader system for dynamic module loading
- Create addon runtime API for secure backend communication
- Update router to support dynamic addon routes
- Integrate addons into the sidebar navigation
- Build addon management UI for administrators

## Implementation Tasks

### 1. Addon Types and Interfaces

#### 1.1 Create Frontend Addon Types

**File: `apps/web/src/lib/addon-types.ts`**

```typescript
import type { AddonManifest, AddonRecord } from '@openaidy/shared-types';

/**
 * Loaded addon instance
 */
export interface LoadedAddon {
  id: string;
  manifest: AddonManifest;
  components: Record<string, any>;
  routes: AddonRoute[];
  isActive: boolean;
}

/**
 * Addon route configuration
 */
export interface AddonRoute {
  path: string;
  component: string;
  componentFn: () => Promise<any>;
  exact?: boolean;
}

/**
 * Addon runtime API provided to loaded addons
 */
export interface AddonRuntime {
  // Agent communication
  invokeAgent(agentId: string, input: any): Promise<any>;

  // Session management
  createSession(config: SessionConfig): Promise<Session>;
  getSession(id: string): Promise<Session>;
  listSessions(): Promise<Session[]>;

  // Configuration access
  getConfig(namespace?: string): Promise<any>;
  setConfig(namespace: string, config: any): Promise<void>;

  // UI utilities
  navigate(path: string): void;
  showNotification(message: string, type: 'info' | 'success' | 'error'): void;

  // Addon metadata
  getAddonInfo(): AddonInfo;

  // Storage (addon-scoped)
  getStorage(key: string): Promise<string | null>;
  setStorage(key: string, value: string): Promise<void>;
  removeStorage(key: string): Promise<void>;
}

/**
 * Addon information available at runtime
 */
export interface AddonInfo {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  config: Record<string, any>;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  agentId?: string;
  message?: string;
  context?: Record<string, any>;
}

/**
 * Session representation
 */
export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'error';
  agentId?: string;
  messages?: any[];
}

/**
 * Addon loader events
 */
export interface AddonLoaderEvents {
  'addon-loaded': (addon: LoadedAddon) => void;
  'addon-unloaded': (addonId: string) => void;
  'addon-error': (addonId: string, error: Error) => void;
}
```

### 2. Addon Loader System

#### 2.1 Create Addon Loader

**File: `apps/web/src/lib/addon-loader.ts`**

```typescript
import type {
  AddonManifest,
  AddonRecord,
  CreateAddonResponse,
} from '@openaidy/shared-types';
import type {
  LoadedAddon,
  AddonRoute,
  AddonRuntime,
  AddonLoaderEvents,
} from './addon-types';
import { createAddonRuntime } from './addon-runtime';
import { getStoredToken } from './auth-token';

export class AddonLoader {
  private loadedAddons = new Map<string, LoadedAddon>();
  private eventListeners = new Map<keyof AddonLoaderEvents, Function[]>();
  private addonBaseUrl: string;

  constructor(addonBaseUrl: string = '/api/addons') {
    this.addonBaseUrl = addonBaseUrl;
  }

  /**
   * Load all enabled addons
   */
  async loadEnabledAddons(): Promise<LoadedAddon[]> {
    try {
      const response = await fetch(`${this.addonBaseUrl}`, {
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch addons: ${response.statusText}`);
      }

      const { addons } = await response.json<{ addons: AddonRecord[] }>();
      const enabledAddons = addons.filter(
        (addon) => addon.status === 'enabled',
      );

      const loadedAddons: LoadedAddon[] = [];

      for (const addon of enabledAddons) {
        try {
          const loadedAddon = await this.loadAddon(addon);
          loadedAddons.push(loadedAddon);
        } catch (error) {
          console.error(`Failed to load addon ${addon.addonId}:`, error);
          this.emit('addon-error', addon.addonId, error as Error);
        }
      }

      return loadedAddons;
    } catch (error) {
      console.error('Failed to load enabled addons:', error);
      throw error;
    }
  }

  /**
   * Load a single addon
   */
  async loadAddon(addonRecord: AddonRecord): Promise<LoadedAddon> {
    const { manifest } = addonRecord;

    // Create addon runtime
    const runtime = createAddonRuntime(addonRecord);

    // Load addon module
    const addonModule = await this.loadAddonModule(addonRecord);

    // Extract components
    const components: Record<string, any> = {};

    // Load route components
    const routes: AddonRoute[] = [];
    for (const routeConfig of manifest.ui.routes) {
      const componentFn = async () => {
        const component = addonModule[routeConfig.component];
        if (!component) {
          throw new Error(
            `Component ${routeConfig.component} not found in addon ${manifest.id}`,
          );
        }
        return component;
      };

      routes.push({
        path: routeConfig.path,
        component: routeConfig.component,
        componentFn,
        exact: routeConfig.exact,
      });

      components[routeConfig.component] = componentFn;
    }

    const loadedAddon: LoadedAddon = {
      id: addonRecord.addonId,
      manifest,
      components,
      routes,
      isActive: true,
    };

    this.loadedAddons.set(addonRecord.addonId, loadedAddon);
    this.emit('addon-loaded', loadedAddon);

    return loadedAddon;
  }

  /**
   * Load addon module dynamically
   */
  private async loadAddonModule(addonRecord: AddonRecord): Promise<any> {
    const { manifest } = addonRecord;

    // In a real implementation, this would load from a CDN or package registry
    // For now, we'll simulate with a placeholder
    const addonUrl = `/addons/${addonRecord.addonId}/${manifest.entry}`;

    try {
      // Dynamic import of addon module
      const module = await import(addonUrl);
      return module;
    } catch (error) {
      // Fallback: create a mock addon module for development
      console.warn(`Failed to load addon module from ${addonUrl}, using mock`);
      return this.createMockAddonModule(manifest);
    }
  }

  /**
   * Create mock addon module for development
   */
  private createMockAddonModule(manifest: AddonManifest): any {
    const components: Record<string, any> = {};

    for (const route of manifest.ui.routes) {
      components[route.component] = () => {
        // Create a mock component
        return (props: any) => ({
          type: 'div',
          props: {
            ...props,
            class: 'addon-mock-component',
            'data-addon': manifest.id,
            'data-component': route.component,
            children: [
              `Mock Component: ${route.component}`,
              `Addon: ${manifest.name}`,
            ],
          },
        });
      };
    }

    return {
      default: components[manifest.ui.routes[0].component],
      ...components,
    };
  }

  /**
   * Unload an addon
   */
  async unloadAddon(addonId: string): Promise<void> {
    const addon = this.loadedAddons.get(addonId);
    if (!addon) {
      return;
    }

    // Mark as inactive
    addon.isActive = false;

    // Remove from loaded addons
    this.loadedAddons.delete(addonId);

    this.emit('addon-unloaded', addonId);
  }

  /**
   * Get loaded addon by ID
   */
  getAddon(addonId: string): LoadedAddon | undefined {
    return this.loadedAddons.get(addonId);
  }

  /**
   * Get all loaded addons
   */
  getAllAddons(): LoadedAddon[] {
    return Array.from(this.loadedAddons.values());
  }

  /**
   * Get addon routes for router integration
   */
  getAddonRoutes(): AddonRoute[] {
    return Array.from(this.loadedAddons.values()).flatMap(
      (addon) => addon.routes,
    );
  }

  /**
   * Get sidebar items for navigation
   */
  getSidebarItems(): Array<{
    id: string;
    label: string;
    icon: string;
    path: string;
    order: number;
  }> {
    return Array.from(this.loadedAddons.values())
      .filter((addon) => addon.isActive)
      .map((addon) => ({
        id: addon.id,
        label: addon.manifest.ui.sidebar.label,
        icon: addon.manifest.ui.sidebar.icon,
        path: addon.manifest.ui.routes[0]?.path || `/addons/${addon.id}`,
        order: addon.manifest.ui.sidebar.order || 999,
      }))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Event handling
   */
  on<K extends keyof AddonLoaderEvents>(
    event: K,
    listener: AddonLoaderEvents[K],
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off<K extends keyof AddonLoaderEvents>(
    event: K,
    listener: AddonLoaderEvents[K],
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof AddonLoaderEvents>(
    event: K,
    ...args: Parameters<AddonLoaderEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => listener(...args));
    }
  }
}

// Global addon loader instance
export const addonLoader = new AddonLoader();
```

### 3. Addon Runtime API

#### 3.1 Create Addon Runtime

**File: `apps/web/src/lib/addon-runtime.ts`**

```typescript
import type { AddonRecord } from '@openaidy/shared-types';
import type {
  AddonRuntime,
  AddonInfo,
  SessionConfig,
  Session,
} from './addon-types';
import { getStoredToken } from './auth-token';

export function createAddonRuntime(addonRecord: AddonRecord): AddonRuntime {
  const addonProxyUrl = '/api/addon-proxy';
  const token = getStoredToken();

  /**
   * Make authenticated request to addon proxy
   */
  async function proxyRequest(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`${addonProxyUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Unknown error' }));
      throw new Error(
        error.message || `Request failed: ${response.statusText}`,
      );
    }

    return response;
  }

  return {
    /**
     * Invoke an agent
     */
    async invokeAgent(agentId: string, input: any): Promise<any> {
      const response = await proxyRequest(`/agents/${agentId}/invoke`, {
        method: 'POST',
        body: JSON.stringify({ input }),
      });

      return response.json();
    },

    /**
     * Create a new session
     */
    async createSession(config: SessionConfig): Promise<Session> {
      const response = await proxyRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify({ config }),
      });

      return response.json();
    },

    /**
     * Get a session by ID
     */
    async getSession(id: string): Promise<Session> {
      const response = await proxyRequest(`/sessions/${id}`);
      return response.json();
    },

    /**
     * List all sessions
     */
    async listSessions(): Promise<Session[]> {
      const response = await proxyRequest('/sessions');
      const result = await response.json();
      return result.sessions || [];
    },

    /**
     * Get configuration
     */
    async getConfig(namespace?: string): Promise<any> {
      const endpoint = namespace ? `/config/${namespace}` : '/config';
      const response = await proxyRequest(endpoint);
      return response.json();
    },

    /**
     * Set configuration
     */
    async setConfig(namespace: string, config: any): Promise<void> {
      await proxyRequest(`/config/${namespace}`, {
        method: 'PUT',
        body: JSON.stringify(config),
      });
    },

    /**
     * Navigate to a route
     */
    navigate(path: string): void {
      // Use router navigation - this will be injected
      if (window.__OPENAIDY_ROUTER__) {
        window.__OPENAIDY_ROUTER__.navigate(path);
      } else {
        // Fallback
        window.location.hash = path;
      }
    },

    /**
     * Show notification
     */
    showNotification(
      message: string,
      type: 'info' | 'success' | 'error',
    ): void {
      // Use notification system - this will be injected
      if (window.__OPENAIDY_NOTIFICATIONS__) {
        window.__OPENAIDY_NOTIFICATIONS__.show(message, type);
      } else {
        // Fallback
        console.log(`[${type.toUpperCase()}] ${message}`);
        alert(`${type.toUpperCase()}: ${message}`);
      }
    },

    /**
     * Get addon information
     */
    getAddonInfo(): AddonInfo {
      return {
        id: addonRecord.addonId,
        name: addonRecord.name,
        version: addonRecord.version,
        permissions: addonRecord.permissions,
        config: addonRecord.config,
      };
    },

    /**
     * Get addon-scoped storage value
     */
    async getStorage(key: string): Promise<string | null> {
      const storageKey = `addon:${addonRecord.addonId}:${key}`;
      return localStorage.getItem(storageKey);
    },

    /**
     * Set addon-scoped storage value
     */
    async setStorage(key: string, value: string): Promise<void> {
      const storageKey = `addon:${addonRecord.addonId}:${key}`;
      localStorage.setItem(storageKey, value);
    },

    /**
     * Remove addon-scoped storage value
     */
    async removeStorage(key: string): Promise<void> {
      const storageKey = `addon:${addonRecord.addonId}:${key}`;
      localStorage.removeItem(storageKey);
    },
  };
}

// Extend window interface for global services
declare global {
  interface Window {
    __OPENAIDY_ROUTER__?: {
      navigate(path: string): void;
    };
    __OPENAIDY_NOTIFICATIONS__?: {
      show(message: string, type: 'info' | 'success' | 'error'): void;
    };
  }
}
```

### 4. Router Integration

#### 4.1 Update Router for Dynamic Addon Routes

**File: `apps/web/src/lib/router.ts` (modifications)**

```typescript
import { createRouter, createWebHistory } from 'solid-app-router';
import { addonLoader } from './addon-loader';
import type { AddonRoute } from './addon-types';

// Existing routes...
const routes = [
  {
    path: '/',
    component: lazy(() => import('./components/pages/DashboardPage')),
  },
  {
    path: '/agents',
    component: lazy(() => import('./components/pages/AgentsPage')),
  },
  {
    path: '/sessions',
    component: lazy(() => import('./components/pages/SessionsPage')),
  },
  {
    path: '/access-tokens',
    component: lazy(() => import('./components/pages/AccessTokensPage')),
  },
  {
    path: '/addons',
    component: lazy(() => import('./components/pages/AddonsPage')),
  },
  // Addon routes will be added dynamically
];

export const router = createRouter(routes, {
  base: import.meta.env.BASE_URL,
  mode: 'web',
});

/**
 * Load addon routes and register them with the router
 */
export async function loadAddonRoutes(): Promise<void> {
  try {
    const addonRoutes = addonLoader.getAddonRoutes();

    for (const addonRoute of addonRoutes) {
      // Create lazy-loaded component for addon route
      const lazyComponent = lazy(async () => {
        const componentFn = await addonRoute.componentFn();
        return {
          default: componentFn,
        };
      });

      // Add route to router
      router.addRoute({
        path: addonRoute.path,
        component: lazyComponent,
        exact: addonRoute.exact,
      });
    }

    // Provide router to addon runtime
    window.__OPENAIDY_ROUTER__ = {
      navigate: (path: string) => router.navigate(path),
    };
  } catch (error) {
    console.error('Failed to load addon routes:', error);
  }
}

/**
 * Initialize router with addon support
 */
export async function initializeRouter(): Promise<void> {
  // Load addons first
  await addonLoader.loadEnabledAddons();

  // Then load addon routes
  await loadAddonRoutes();

  // Start router
  router.start();
}
```

### 5. Sidebar Integration

#### 5.1 Update Sidebar for Addon Navigation

**File: `apps/web/src/components/Sidebar.tsx` (modifications)**

```typescript
import { For, createEffect, createSignal } from 'solid-js';
import {
  Home,
  Bot,
  MessageSquare,
  Key,
  Puzzle,
  Settings
} from 'lucide-solid';
import { addonLoader } from '../lib/addon-loader';
import { useLocation } from 'solid-app-router';

const iconMap = {
  'home': Home,
  'bot': Bot,
  'message-square': MessageSquare,
  'key': Key,
  'puzzle': Puzzle,
  'settings': Settings,
};

export function Sidebar() {
  const location = useLocation();
  const [addonItems, setAddonItems] = createSignal<Array<{
    id: string;
    label: string;
    icon: string;
    path: string;
    order: number;
  }>>([]);

  // Load addon items when addons are loaded
  createEffect(() => {
    const loadAddonItems = () => {
      const items = addonLoader.getSidebarItems();
      setAddonItems(items);
    };

    // Load initial items
    loadAddonItems();

    // Listen for addon changes
    addonLoader.on('addon-loaded', loadAddonItems);
    addonLoader.on('addon-unloaded', loadAddonItems);

    return () => {
      addonLoader.off('addon-loaded', loadAddonItems);
      addonLoader.off('addon-unloaded', loadAddonItems);
    };
  });

  const baseNavigation = [
    {
      href: '/',
      label: 'Dashboard',
      icon: 'home',
    },
    {
      href: '/agents',
      label: 'Agents',
      icon: 'bot',
    },
    {
      href: '/sessions',
      label: 'Sessions',
      icon: 'message-square',
    },
    {
      href: '/access-tokens',
      label: 'Access Tokens',
      icon: 'key',
    },
    {
      href: '/addons',
      label: 'Addons',
      icon: 'puzzle',
    },
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(href);
  };

  return (
    <div class="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 h-full flex flex-col">
      {/* Logo */}
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <h1 class="text-xl font-bold text-text-primary">OpenAidy</h1>
      </div>

      {/* Navigation */}
      <nav class="flex-1 p-4 space-y-2">
        {/* Base Navigation */}
        <For each={baseNavigation}>
          {(item) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap];
            return (
              <a
                href={item.href}
                class={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-primary text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Icon class="w-4 h-4" />
                {item.label}
              </a>
            );
          }}
        </For>

        {/* Addon Navigation */}
        <Show when={addonItems().length > 0}>
          <div class="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 class="px-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
              Addons
            </h3>
            <For each={addonItems()}>
              {(item) => {
                // Try to get icon from lucide, fallback to Puzzle
                const Icon = (iconMap as any)[item.icon] || Puzzle;
                return (
                  <a
                    href={item.path}
                    class={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive(item.path)
                        ? 'bg-primary text-white'
                        : 'text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Icon class="w-4 h-4" />
                    {item.label}
                  </a>
                );
              }}
            </For>
          </div>
        </Show>
      </nav>

      {/* Footer */}
      <div class="p-4 border-t border-gray-200 dark:border-gray-700">
        <a
          href="/settings"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Settings class="w-4 h-4" />
          Settings
        </a>
      </div>
    </div>
  );
}
```

### 6. Addon Management UI

#### 6.1 Create Addon Management Page

**File: `apps/web/src/components/pages/AddonsPage.tsx`**

```typescript
import {
  For,
  Show,
  createSignal,
  onMount,
  createResource
} from 'solid-js';
import {
  Plus,
  Trash2,
  Power,
  PowerOff,
  Upload,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
} from 'lucide-solid';
import { Layout } from './Layout';
import type { AddonRecord } from '@openaidy/shared-types';

interface AddonFormData {
  name: string;
  package: File | null;
}

export function AddonsPage() {
  const [addons, { refetch }] = createResource(async () => {
    const response = await fetch('/api/addons', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('openaidy_auth_token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch addons');
    }

    const result = await response.json();
    return result.addons as AddonRecord[];
  });

  const [showInstallForm, setShowInstallForm] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [installError, setInstallError] = createSignal<string | null>(null);
  const [formData, setFormData] = createSignal<AddonFormData>({
    name: '',
    package: null,
  });

  const [actionInProgress, setActionInProgress] = createSignal<string | null>(null);

  const handleInstall = async () => {
    const data = formData();
    if (!data.package) {
      setInstallError('Please select a package file');
      return;
    }

    setInstalling(true);
    setInstallError(null);

    try {
      // Convert file to base64
      const packageBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(data.package!);
      });

      const response = await fetch('/api/addons', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('openaidy_auth_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manifest: {
            // For now, we'll extract manifest from package
            // In real implementation, this would be parsed from the package
            id: data.name.toLowerCase().replace(/\s+/g, '-'),
            name: data.name,
            version: '1.0.0',
            description: 'Uploaded addon',
            author: { name: 'User' },
            openaidy: { minVersion: '1.0.0' },
            entry: './dist/index.js',
            permissions: [],
            ui: {
              sidebar: { icon: 'puzzle', label: data.name },
              routes: [{ path: `/addons/${data.name.toLowerCase()}`, component: 'MainPage' }],
            },
            agents: [],
          },
          package: packageBase64.split(',')[1], // Remove data:image/...;base64, prefix
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Installation failed');
      }

      const result = await response.json();

      // If approval is required, show message
      if (result.requiresApproval) {
        alert('Addon installed successfully and requires admin approval before activation.');
      }

      setShowInstallForm(false);
      setFormData({ name: '', package: null });
      refetch();
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const handleToggleStatus = async (addon: AddonRecord) => {
    setActionInProgress(addon.id);

    try {
      const endpoint = addon.status === 'enabled' ? 'disable' : 'enable';
      const response = await fetch(`/api/addons/${addon.addonId}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('openaidy_auth_token')}`,
        },
        body: addon.status === 'installed' ? JSON.stringify({
          approvedPermissions: addon.manifest.permissions.map(p => {
            // Convert permission objects to strings
            if (p.type === 'agent') return `agents.invoke:${p.target}`;
            if (p.type === 'session') return `sessions.${p.action}`;
            if (p.type === 'config') return `config.${p.action}`;
            return `system.${p.action}`;
          }),
        }) : undefined,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Action failed');
      }

      refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUninstall = async (addon: AddonRecord) => {
    if (!confirm(`Are you sure you want to uninstall "${addon.name}"?`)) {
      return;
    }

    setActionInProgress(addon.id);

    try {
      const response = await fetch(`/api/addons/${addon.addonId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('openaidy_auth_token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Uninstall failed');
      }

      refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Uninstall failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'enabled':
        return CheckCircle;
      case 'disabled':
        return PowerOff;
      case 'error':
        return AlertTriangle;
      default:
        return Clock;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'enabled':
        return 'text-green-600 dark:text-green-400';
      case 'disabled':
        return 'text-gray-600 dark:text-gray-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-yellow-600 dark:text-yellow-400';
    }
  };

  return (
    <Layout
      title="Addons"
      description="Manage OpenAidy addons and extensions"
      actions={
        <button
          onClick={() => setShowInstallForm(true)}
          class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          Install Addon
        </button>
      }
    >
      {/* Install Form Modal */}
      <Show when={showInstallForm()}>
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 class="text-lg font-semibold text-text-primary mb-4">
              Install New Addon
            </h2>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1">
                  Addon Name
                </label>
                <input
                  type="text"
                  value={formData().name}
                  onInput={(e) => setFormData({ ...formData(), name: e.currentTarget.value })}
                  placeholder="Enter addon name"
                  class="w-full px-3 py-2 rounded-lg border border-border bg-gray-50 dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-text-primary mb-1">
                  Package File
                </label>
                <input
                  type="file"
                  accept=".tar.gz,.zip"
                  onChange={(e) => setFormData({ ...formData(), package: e.currentTarget.files?.[0] || null })}
                  class="w-full px-3 py-2 rounded-lg border border-border bg-gray-50 dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>

              <Show when={installError()}>
                <p class="text-sm text-red-500 dark:text-red-400">
                  {installError()}
                </p>
              </Show>

              <div class="flex items-center gap-2 pt-2">
                <button
                  onClick={() => void handleInstall()}
                  disabled={installing() || !formData().name || !formData().package}
                  class="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {installing() ? 'Installing…' : 'Install'}
                </button>
                <button
                  onClick={() => {
                    setShowInstallForm(false);
                    setInstallError(null);
                    setFormData({ name: '', package: null });
                  }}
                  class="px-4 py-2 text-text-secondary hover:text-text-primary text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Loading State */}
      <Show when={addons.loading}>
        <div class="flex items-center justify-center h-48">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </Show>

      {/* Error State */}
      <Show when={!addons.loading && addons.error}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <div class="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle class="w-4 h-4 flex-shrink-0" />
            <span class="text-sm">
              {addons.error instanceof Error ? addons.error.message : 'Failed to load addons'}
            </span>
          </div>
        </div>
      </Show>

      {/* Addons List */}
      <Show when={!addons.loading && !addons.error && addons()}>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-sm font-semibold text-text-primary">
              Installed Addons ({addons()?.length || 0})
            </h2>
          </div>

          <Show when={addons()?.length === 0}>
            <div class="p-8 text-center">
              <Puzzle class="w-12 h-12 text-text-tertiary mx-auto mb-4" />
              <p class="text-text-secondary font-medium">No addons installed</p>
              <p class="text-sm text-text-tertiary mt-1">
                Install your first addon to extend OpenAidy's functionality
              </p>
            </div>
          </Show>

          <Show when={addons()?.length > 0}>
            <div class="divide-y divide-gray-100 dark:divide-gray-700">
              <For each={addons()}>
                {(addon) => {
                  const StatusIcon = getStatusIcon(addon.status);
                  return (
                    <div class="px-4 py-4">
                      <div class="flex items-start justify-between">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 mb-1">
                            <h3 class="text-sm font-medium text-text-primary truncate">
                              {addon.name}
                            </h3>
                            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(addon.status)}`}>
                              <StatusIcon class="w-3 h-3" />
                              {addon.status}
                            </span>
                          </div>

                          <p class="text-sm text-text-secondary mb-2">
                            {addon.manifest.description}
                          </p>

                          <div class="flex items-center gap-4 text-xs text-text-tertiary">
                            <span>Version {addon.version}</span>
                            <span>ID: {addon.addonId}</span>
                            <span>Installed {new Date(addon.installedAt).toLocaleDateString()}</span>
                          </div>

                          <Show when={addon.permissions.length > 0}>
                            <div class="mt-2">
                              <p class="text-xs text-text-tertiary mb-1">Permissions:</p>
                              <div class="flex flex-wrap gap-1">
                                <For each={addon.permissions}>
                                  {(permission) => (
                                    <span class="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                                      {permission}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>

                        <div class="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => void handleToggleStatus(addon)}
                            disabled={actionInProgress() === addon.id}
                            title={addon.status === 'enabled' ? 'Disable addon' : 'Enable addon'}
                            class="flex-shrink-0 p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
                          >
                            {addon.status === 'enabled' ? (
                              <Power class="w-4 h-4" />
                            ) : (
                              <PowerOff class="w-4 h-4" />
                            )}
                          </button>

                          <button
                            onClick={() => void handleUninstall(addon)}
                            disabled={actionInProgress() === addon.id}
                            title="Uninstall addon"
                            class="flex-shrink-0 p-1.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Layout>
  );
}
```

### 7. App Integration

#### 7.1 Update App.tsx for Addon Support

**File: `apps/web/src/App.tsx` (modifications)**

```typescript
import { onMount } from 'solid-js';
import { Router } from 'solid-app-router';
import { Sidebar } from './components/Sidebar';
import { initializeRouter } from './lib/router';
import { addonLoader } from './lib/addon-loader';

export function App() {
  onMount(async () => {
    try {
      // Initialize router with addon support
      await initializeRouter();

      // Set up global notification system
      window.__OPENAIDY_NOTIFICATIONS__ = {
        show: (message: string, type: 'info' | 'success' | 'error') => {
          // TODO: Implement proper notification system
          console.log(`[${type.toUpperCase()}] ${message}`);
        },
      };
    } catch (error) {
      console.error('Failed to initialize app:', error);
    }
  });

  return (
    <div class="h-screen flex bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main class="flex-1 flex flex-col overflow-hidden">
        <Router>
          {/* Routes will be added dynamically */}
        </Router>
      </main>
    </div>
  );
}
```

### 8. Mock Addon Example

#### 8.1 Create Example Addon

**File: `addons/example-price-analyzer/dist/index.js`**

```javascript
// Example addon for price analysis
export default function PriceAnalyzerPage() {
  return {
    type: 'div',
    props: {
      class: 'p-6',
      children: [
        {
          type: 'h1',
          props: {
            class: 'text-2xl font-bold mb-4',
            children: 'Price Analyzer',
          },
        },
        {
          type: 'p',
          props: {
            class: 'text-gray-600 mb-6',
            children:
              'Analyze prices across multiple sources with AI-powered insights.',
          },
        },
        {
          type: 'div',
          props: {
            class: 'bg-white dark:bg-gray-800 rounded-lg shadow p-6',
            children: [
              {
                type: 'h2',
                props: {
                  class: 'text-lg font-semibold mb-4',
                  children: 'Quick Analysis',
                },
              },
              {
                type: 'button',
                props: {
                  class:
                    'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700',
                  onClick: () => {
                    // Use addon runtime to communicate with backend
                    if (window.__ADDON_RUNTIME__) {
                      window.__ADDON_RUNTIME__
                        .invokeAgent('price-analyzer', {
                          query: 'iPhone 15 Pro price',
                          sources: ['amazon', 'ebay', 'bestbuy'],
                        })
                        .then((result) => {
                          console.log('Analysis result:', result);
                          window.__ADDON_RUNTIME__.showNotification(
                            'Analysis completed successfully',
                            'success',
                          );
                        })
                        .catch((error) => {
                          console.error('Analysis failed:', error);
                          window.__ADDON_RUNTIME__.showNotification(
                            'Analysis failed: ' + error.message,
                            'error',
                          );
                        });
                    }
                  },
                  children: 'Analyze iPhone Prices',
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export function HistoryPage() {
  return {
    type: 'div',
    props: {
      class: 'p-6',
      children: [
        {
          type: 'h1',
          props: {
            class: 'text-2xl font-bold mb-4',
            children: 'Price History',
          },
        },
        {
          type: 'p',
          props: {
            class: 'text-gray-600',
            children: 'View historical price analysis results.',
          },
        },
      ],
    },
  };
}
```

### 9. Testing

#### 9.1 Create Addon Loader Tests

**File: `apps/web/src/lib/addon-loader.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddonLoader } from './addon-loader';
import type { AddonRecord } from '@openaidy/shared-types';

describe('AddonLoader', () => {
  let addonLoader: AddonLoader;
  let mockFetch: ReturnType<typeof vi.fn>;

  const mockAddonRecord: AddonRecord = {
    id: 'addon-id',
    addonId: 'test-addon',
    name: 'Test Addon',
    version: '1.0.0',
    manifest: {
      id: 'test-addon',
      name: 'Test Addon',
      version: '1.0.0',
      description: 'Test addon',
      author: { name: 'Test' },
      openaidy: { minVersion: '1.0.0' },
      entry: './dist/index.js',
      permissions: [],
      ui: {
        sidebar: { icon: 'test', label: 'Test Addon' },
        routes: [{ path: '/test-addon', component: 'TestPage' }],
      },
      agents: [],
    },
    status: 'enabled',
    permissions: [],
    config: {},
    installedAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    installedBy: 'test-user',
  };

  beforeEach(() => {
    addonLoader = new AddonLoader();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe('loadEnabledAddons', () => {
    it('should load enabled addons successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ addons: [mockAddonRecord] }),
      });

      const addons = await addonLoader.loadEnabledAddons();

      expect(addons).toHaveLength(1);
      expect(addons[0].id).toBe('test-addon');
      expect(addons[0].isActive).toBe(true);
    });

    it('should handle loading errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(addonLoader.loadEnabledAddons()).rejects.toThrow(
        'Network error',
      );
    });
  });

  describe('getSidebarItems', () => {
    it('should return sorted sidebar items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ addons: [mockAddonRecord] }),
      });

      await addonLoader.loadEnabledAddons();
      const items = addonLoader.getSidebarItems();

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        id: 'test-addon',
        label: 'Test Addon',
        icon: 'test',
        path: '/test-addon',
        order: 999,
      });
    });
  });

  describe('event handling', () => {
    it('should emit and listen to events', () => {
      const mockListener = vi.fn();

      addonLoader.on('addon-loaded', mockListener);
      addonLoader.emit('addon-loaded', { id: 'test' } as any);

      expect(mockListener).toHaveBeenCalledWith({ id: 'test' });
    });

    it('should remove event listeners', () => {
      const mockListener = vi.fn();

      addonLoader.on('addon-loaded', mockListener);
      addonLoader.off('addon-loaded', mockListener);
      addonLoader.emit('addon-loaded', { id: 'test' } as any);

      expect(mockListener).not.toHaveBeenCalled();
    });
  });
});
```

## Success Criteria

Phase 2 is complete when:

1. ✅ **Addon Loading**: Addons can be dynamically loaded and their components accessed
2. ✅ **Runtime API**: Addons can communicate with backend through secure proxy
3. ✅ **Router Integration**: Addon routes are dynamically registered and navigable
4. ✅ **Sidebar Integration**: Addons appear in sidebar with proper navigation
5. ✅ **Management UI**: Admins can install, enable, disable, and uninstall addons
6. ✅ **Event System**: Addon lifecycle events are properly handled
7. ✅ **Storage**: Addons have scoped local storage for persistence

## Next Steps

After Phase 2 completion:

- Begin Phase 3: Security enhancements and isolation
- Create comprehensive addon documentation
- Build addon development tools and templates
- Test with real addon implementations

This phase provides the complete frontend foundation that enables addons to be seamlessly integrated into the OpenAidy user experience while maintaining security and performance.
