/**
 * Frontend Addon Type Definitions
 *
 * TypeScript interfaces for the frontend addon system.
 * These types complement the shared addon types from @openaidy/shared-types.
 */

import type { AddonManifest } from '@openaidy/shared-types';

// ============================================================================
// Core Runtime Types
// ============================================================================

/**
 * Represents a loaded addon instance in the frontend
 */
export interface LoadedAddon {
  /** Unique identifier */
  id: string;
  /** The addon manifest */
  manifest: AddonManifest;
  /** Current status of the addon */
  status: AddonStatus;
  /** Access token for API calls (only when enabled) */
  accessToken?: string;
  /** Timestamp when the addon was loaded */
  loadedAt: Date;
  /** Registered components from this addon */
  components: AddonComponentRegistry;
  /** Route definitions from this addon */
  routes: AddonRoute[];
}

/**
 * Addon status in the frontend
 */
export type AddonStatus = 'loading' | 'loaded' | 'error' | 'disabled';

/**
 * Registry of components provided by an addon
 */
export interface AddonComponentRegistry {
  /** Map of component name to lazy-loaded component */
  [componentName: string]: AddonComponent;
}

/**
 * A lazy-loaded component from an addon
 */
export interface AddonComponent {
  /** Name of the component */
  name: string;
  /** The component module */
  component: AddonComponentModule;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * The module containing the addon component
 * Components are lazy-loaded for performance
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AddonComponentModule = () => Promise<any>;

/**
 * Route configuration for addon pages
 */
export interface AddonRoute {
  /** URL path pattern (e.g., /addon/:addonId/dashboard) */
  path: string;
  /** The component to render */
  component: AddonComponentModule;
  /** Optional route metadata */
  metadata?: RouteMetadata;
}

/**
 * Additional route metadata
 */
export interface RouteMetadata {
  /** Human-readable title */
  title?: string;
  /** Icon to display in navigation */
  icon?: string;
  /** Navigation order */
  order?: number;
  /** Required permissions to access */
  requiredPermissions?: string[];
}

// ============================================================================
// Runtime API Types
// ============================================================================

/**
 * Runtime API provided to addon components
 * This is the interface through which addons interact with OpenAidy
 */
export interface AddonRuntime {
  /** Information about the current addon */
  addon: AddonInfo;
  /** Agent-related operations */
  agents: AgentRuntimeAPI;
  /** Session management */
  sessions: SessionRuntimeAPI;
  /** Configuration access */
  config: ConfigRuntimeAPI;
  /** Utility functions */
  utils: RuntimeUtils;
  /** Storage management */
  storage: StorageAPI;
  /** Event system */
  events: EventAPI;
}

/**
 * Information about the addon accessing the runtime
 */
export interface AddonInfo {
  /** Addon ID from manifest */
  id: string;
  /** Addon name */
  name: string;
  /** Addon version */
  version: string;
  /** Permissions granted to this addon */
  permissions: string[];
}

/**
 * Agent runtime API for addon interactions
 */
export interface AgentRuntimeAPI {
  /**
   * Invoke an agent
   * @param agentId - The agent identifier
   * @param input - Input for the agent
   * @param options - Optional invocation options
   */
  invoke(
    agentId: string,
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentInvocationResult>;

  /**
   * List available agents for this addon
   */
  listAgents(): Promise<AgentInfo[]>;

  /**
   * Get agent capabilities
   */
  getAgentCapabilities(agentId: string): Promise<AgentCapabilities>;
}

/**
 * Options for agent invocation
 */
export interface AgentInvokeOptions {
  /** Conversation/session ID */
  sessionId?: string;
  /** Context data to pass to the agent */
  context?: Record<string, unknown>;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Result of an agent invocation
 */
export interface AgentInvocationResult {
  /** The agent's response */
  response: string;
  /** Optional session ID for continued conversation */
  sessionId?: string;
  /** Token usage statistics */
  usage?: TokenUsage;
  /** Any metadata from the agent */
  metadata?: Record<string, unknown>;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Agent information
 */
export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  capabilities: AgentCapabilities;
}

/**
 * Agent capabilities
 */
export interface AgentCapabilities {
  /** Whether the agent supports streaming */
  streaming: boolean;
  /** Maximum input length */
  maxInputLength?: number;
  /** Supported modalities */
  modalities?: ('text' | 'code' | 'image')[];
}

// ============================================================================
// Session Runtime API
// ============================================================================

/**
 * Session management API
 */
export interface SessionRuntimeAPI {
  /**
   * List available sessions
   */
  list(options?: ListSessionsOptions): Promise<Session[]>;

  /**
   * Get a specific session
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Create a new session
   */
  create(config: CreateSessionConfig): Promise<Session>;

  /**
   * Delete a session
   */
  delete(sessionId: string): Promise<void>;
}

/**
 * Options for listing sessions
 */
export interface ListSessionsOptions {
  /** Maximum number of sessions to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by status */
  status?: 'active' | 'archived';
}

/**
 * Session representation
 */
export interface Session {
  id: string;
  title: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

/**
 * Configuration for creating a session
 */
export interface CreateSessionConfig {
  /** Session title */
  title?: string;
  /** Initial context */
  context?: Record<string, unknown>;
}

// ============================================================================
// Config Runtime API
// ============================================================================

/**
 * Configuration access API
 */
export interface ConfigRuntimeAPI {
  /**
   * Get a configuration value
   * @param namespace - The config namespace (e.g., 'pricing', 'display')
   */
  get(namespace: string): Promise<Record<string, unknown>>;

  /**
   * Get a specific config key
   */
  getKey(namespace: string, key: string): Promise<unknown>;

  /**
   * List available namespaces
   */
  listNamespaces(): Promise<string[]>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Runtime utility functions
 */
export interface RuntimeUtils {
  /** Show a notification to the user */
  notify: (message: string, type?: NotificationType) => void;
  /** Format a date */
  formatDate: (date: Date | string) => string;
  /** Format relative time */
  formatRelativeTime: (date: Date | string) => string;
  /** Copy text to clipboard */
  copyToClipboard: (text: string) => Promise<void>;
}

/**
 * Notification type
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

// ============================================================================
// Storage API
// ============================================================================

/**
 * Secure storage for addon data
 */
export interface StorageAPI {
  /**
   * Get a value from storage
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in storage
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Remove a value from storage
   */
  remove(key: string): Promise<void>;

  /**
   * Clear all addon data
   */
  clear(): Promise<void>;

  /**
   * List all keys
   */
  keys(): Promise<string[]>;
}

// ============================================================================
// Event System
// ============================================================================

/**
 * Event system for addon lifecycle
 */
export interface EventAPI {
  /**
   * Subscribe to an event
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;

  /**
   * Emit an event
   */
  emit<T = unknown>(event: string, data: T): void;

  /**
   * Subscribe to an event once
   */
  once<T = unknown>(event: string, handler: EventHandler<T>): () => void;
}

/**
 * Event handler function
 */
export type EventHandler<T = unknown> = (data: T) => void;

// ============================================================================
// Addon Loader Events
// ============================================================================

/**
 * Events emitted during addon loading
 */
export interface AddonLoaderEvents {
  /** Fired when addon loading starts */
  onLoadStart?: (addonId: string) => void;
  /** Fired when addon is successfully loaded */
  onLoadComplete?: (addon: LoadedAddon) => void;
  /** Fired when addon loading fails */
  onLoadError?: (addonId: string, error: Error) => void;
  /** Fired when addon is enabled */
  onEnable?: (addon: LoadedAddon) => void;
  /** Fired when addon is disabled */
  onDisable?: (addonId: string) => void;
  /** Fired when addon is unloaded */
  onUnload?: (addonId: string) => void;
}

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Check if a value is a valid LoadedAddon
 */
export function isLoadedAddon(value: unknown): value is LoadedAddon {
  if (!value || typeof value !== 'object') return false;
  const addon = value as LoadedAddon;
  return (
    typeof addon.id === 'string' &&
    addon.manifest !== undefined &&
    ['loading', 'loaded', 'error', 'disabled'].includes(addon.status)
  );
}

/**
 * Check if addon has a specific permission
 */
export function hasPermission(addon: AddonInfo, permission: string): boolean {
  return (
    addon.permissions.includes(permission) || addon.permissions.includes('*')
  );
}

/**
 * Check if a permission matches a pattern
 */
export function matchesPermission(
  granted: string[],
  requested: string,
): boolean {
  return (
    granted.includes('*') ||
    granted.includes(requested) ||
    granted.some((g) => {
      if (g.endsWith('.*')) {
        const prefix = g.slice(0, -2);
        return requested.startsWith(prefix + '.');
      }
      if (g.includes(':')) {
        // Scoped permission: agents.invoke:price matches agents.invoke:price
        // But 'agents.invoke' does NOT match 'agents.invoke:price'
        const [gResource, ...gScopeParts] = g.split(':');
        const [reqResource, ...reqScopeParts] = requested.split(':');
        const gScope = gScopeParts.join(':');
        const reqScope = reqScopeParts.join(':');
        // Must have same resource.action
        if (gResource !== reqResource) return false;
        // If granted has scope, requested must have same scope
        if (gScope && gScope !== reqScope) return false;
        return true;
      }
      return false;
    })
  );
}

// ============================================================================
// Global Window Extension
// ============================================================================

/**
 * Extend Window to include addon runtime
 */
declare global {
  interface Window {
    /** Addon runtime API when running inside an addon */
    __ADDON_RUNTIME__?: AddonRuntime;
  }
}
