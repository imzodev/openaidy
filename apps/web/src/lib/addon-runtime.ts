/**
 * Addon Runtime API Implementation
 *
 * Runtime API implementation for addon components to interact with OpenAidy.
 */

import type {
  AddonRuntime,
  AddonInfo,
  AgentRuntimeAPI,
  SessionRuntimeAPI,
  ConfigRuntimeAPI,
  RuntimeUtils,
  StorageAPI,
  EventAPI,
  NotificationType,
  AgentInvokeOptions,
  AgentInvocationResult,
  AgentInfo,
  AgentCapabilities,
  ListSessionsOptions,
  Session,
  CreateSessionConfig,
  LoadedAddon,
  AddonLoaderEvents,
} from './addon-types';

// ============================================================================
// Event Emitter Implementation
// ============================================================================

/**
 * Simple event emitter implementation
 */
class EventEmitter implements EventAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();

  on<T = unknown>(event: string, handler: (data: T) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as (...args: unknown[]) => void);

    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
    };
  }

  once<T = unknown>(event: string, handler: (data: T) => void): () => void {
    const unsubscribe = this.on<T>(event, (data) => {
      unsubscribe();
      handler(data);
    });
    return unsubscribe;
  }

  emit<T = unknown>(event: string, data: T): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }
}

// ============================================================================
// Storage Implementation
// ============================================================================

/**
 * Storage implementation with addon-specific prefix
 */
class AddonStorage implements StorageAPI {
  private addonId: string;

  constructor(addonId: string) {
    this.addonId = addonId;
  }

  private prefix(): string {
    return `addon_${this.addonId}_`;
  }

  private key(key: string): string {
    return `${this.prefix()}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = localStorage.getItem(this.key(key));
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(this.key(key), JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.key(key));
  }

  async clear(): Promise<void> {
    const prefix = this.prefix();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }

  async keys(): Promise<string[]> {
    const prefix = this.prefix();
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        result.push(key.slice(prefix.length));
      }
    }
    return result;
  }
}

// ============================================================================
// API Client
// ============================================================================

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const response = await fetch(endpoint, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Runtime Factory
// ============================================================================

/**
 * Create a runtime API for an addon
 */
export function createAddonRuntime(
  addon: LoadedAddon,
  baseUrl: string,
): AddonRuntime {
  const events = new EventEmitter();

  // Create the addon info
  const addonInfo: AddonInfo = {
    id: addon.manifest.id,
    name: addon.manifest.name,
    version: addon.manifest.version,
    permissions: addon.manifest.permissions,
  };

  // ==========================================================================
  // Agent API
  // ==========================================================================
  const agents: AgentRuntimeAPI = {
    async invoke(
      agentId: string,
      input: string,
      options?: AgentInvokeOptions,
    ): Promise<AgentInvocationResult> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      const response = await apiRequest<AgentInvocationResult>(
        `${baseUrl}/api/addon-proxy/agents/${agentId}/invoke`,
        {
          method: 'POST',
          token: addon.accessToken,
          body: JSON.stringify({ input, context: options?.context }),
        },
      );

      return response;
    },

    async listAgents(): Promise<AgentInfo[]> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      const manifest = addon.manifest;
      if (!manifest.agents) {
        return [];
      }

      return manifest.agents.map((agent) => ({
        id: agent.id,
        name: agent.id,
        description: agent.description,
        capabilities: {
          streaming: true,
          modalities: ['text'],
        },
      }));
    },

    async getAgentCapabilities(agentId: string): Promise<AgentCapabilities> {
      const agents = await this.listAgents();
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return agent.capabilities;
    },
  };

  // ==========================================================================
  // Session API
  // ==========================================================================
  const sessions: SessionRuntimeAPI = {
    async list(options?: ListSessionsOptions): Promise<Session[]> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.offset) params.set('offset', String(options.offset));
      if (options?.status) params.set('status', options.status);

      const response = await apiRequest<{ sessions: Session[] }>(
        `${baseUrl}/api/addon-proxy/sessions?${params}`,
        { token: addon.accessToken },
      );

      return response.sessions;
    },

    async get(sessionId: string): Promise<Session | null> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      try {
        const response = await apiRequest<{ session: Session }>(
          `${baseUrl}/api/addon-proxy/sessions/${sessionId}`,
          { token: addon.accessToken },
        );
        return response.session;
      } catch {
        return null;
      }
    },

    async create(config: CreateSessionConfig): Promise<Session> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      const response = await apiRequest<{ session: Session }>(
        `${baseUrl}/api/addon-proxy/sessions`,
        {
          method: 'POST',
          token: addon.accessToken,
          body: JSON.stringify(config),
        },
      );

      return response.session;
    },

    async delete(sessionId: string): Promise<void> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      await apiRequest<void>(
        `${baseUrl}/api/addon-proxy/sessions/${sessionId}`,
        {
          method: 'DELETE',
          token: addon.accessToken,
        },
      );
    },
  };

  // ==========================================================================
  // Config API
  // ==========================================================================
  const config: ConfigRuntimeAPI = {
    async get(namespace: string): Promise<Record<string, unknown>> {
      if (!addon.accessToken) {
        throw new Error('Addon is not enabled');
      }

      const response = await apiRequest<{ config: Record<string, unknown> }>(
        `${baseUrl}/api/addon-proxy/config/${namespace}`,
        { token: addon.accessToken },
      );

      return response.config;
    },

    async getKey(namespace: string, key: string): Promise<unknown> {
      const configData = await this.get(namespace);
      return configData[key];
    },

    async listNamespaces(): Promise<string[]> {
      // This would require a dedicated endpoint
      // For now, return empty
      return [];
    },
  };

  // ==========================================================================
  // Utils
  // ==========================================================================
  const utils: RuntimeUtils = {
    notify(message: string, type: NotificationType = 'info'): void {
      // Dispatch a custom event that the UI can listen to
      events.emit('notify', { message, type });
    },

    formatDate(date: Date | string): string {
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString();
    },

    formatRelativeTime(date: Date | string): string {
      const d = typeof date === 'string' ? new Date(date) : date;
      const now = new Date();
      const diff = now.getTime() - d.getTime();

      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}d ago`;
      if (hours > 0) return `${hours}h ago`;
      if (minutes > 0) return `${minutes}m ago`;
      return 'just now';
    },

    async copyToClipboard(text: string): Promise<void> {
      await navigator.clipboard.writeText(text);
    },
  };

  // ==========================================================================
  // Storage
  // ==========================================================================
  const storage = new AddonStorage(addon.manifest.id);

  return {
    addon: addonInfo,
    agents,
    sessions,
    config,
    utils,
    storage,
    events,
  };
}

// ============================================================================
// Addon Loader
// ============================================================================

/**
 * Events that can be subscribed to during addon loading
 */
export interface AddonLoaderOptions {
  /** Base URL for API calls */
  baseUrl: string;
  /** Event handlers */
  events?: AddonLoaderEvents;
}

/**
 * Load an addon
 */
export async function loadAddon(
  manifest: import('@openaidy/shared-types').AddonManifest,
  options: AddonLoaderOptions,
): Promise<LoadedAddon> {
  const { events } = options;

  events?.onLoadStart?.(manifest.id);

  try {
    // Create the loaded addon structure
    const addon: LoadedAddon = {
      id: manifest.id,
      manifest,
      status: 'loading',
      loadedAt: new Date(),
      components: {},
      routes: [],
    };

    // Load components and routes from manifest
    if (manifest.ui?.routes) {
      for (const route of manifest.ui.routes) {
        addon.routes.push({
          path: route.path,
          component: () => import(/* @vite-ignore */ route.component),
        });
      }
    }

    addon.status = 'loaded';
    events?.onLoadComplete?.(addon);

    return addon;
  } catch (error) {
    events?.onLoadError?.(manifest.id, error as Error);
    throw error;
  }
}

/**
 * Enable an addon (requires admin approval flow)
 */
export async function enableAddon(
  addon: LoadedAddon,
  options: AddonLoaderOptions & { accessToken: string },
): Promise<LoadedAddon> {
  const updatedAddon: LoadedAddon = {
    ...addon,
    status: 'loaded',
    accessToken: options.accessToken,
  };

  options.events?.onEnable?.(updatedAddon);

  return updatedAddon;
}

/**
 * Disable an addon
 */
export function disableAddon(
  addon: LoadedAddon,
  events?: AddonLoaderEvents,
): LoadedAddon {
  const updatedAddon: LoadedAddon = {
    ...addon,
    status: 'disabled',
    accessToken: undefined,
  };

  events?.onDisable?.(addon.id);

  return updatedAddon;
}

/**
 * Unload an addon
 */
export function unloadAddon(addonId: string, events?: AddonLoaderEvents): void {
  events?.onUnload?.(addonId);
}
