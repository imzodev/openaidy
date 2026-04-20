/**
 * Addon Mock Implementations
 *
 * Mock implementations for addon system dependencies in tests.
 */

import type { AddonManifest } from '@openaidy/shared-types';

// ============================================================================
// Mock Addon Registry
// ============================================================================

/**
 * Mock addon registry for testing
 */
export class MockAddonRegistry {
  private addons: Map<string, AddonManifest> = new Map();

  add(addon: AddonManifest): void {
    this.addons.set(addon.id, addon);
  }

  get(id: string): AddonManifest | undefined {
    return this.addons.get(id);
  }

  list(): AddonManifest[] {
    return Array.from(this.addons.values());
  }

  remove(id: string): void {
    this.addons.delete(id);
  }

  clear(): void {
    this.addons.clear();
  }
}

// ============================================================================
// Mock Runtime Proxy
// ============================================================================

/**
 * Mock runtime proxy for testing
 */
export class MockRuntimeProxy {
  async healthCheck(): Promise<boolean> {
    return true;
  }

  async invokeAgent(
    _token: string,
    _agentId: string,
    _input: string,
    _options?: unknown,
  ): Promise<unknown> {
    return {
      response: 'Mock response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    };
  }

  async listAgents(_token: string): Promise<unknown> {
    return { agents: [] };
  }

  async listSessions(_token: string, _options?: unknown): Promise<unknown> {
    return { sessions: [] };
  }
}

// ============================================================================
// Mock Event Emitter
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandlerType = (data: any) => void;

/**
 * Mock event emitter for testing
 */
export class MockEventEmitter {
  private handlers: Map<string, Set<EventHandlerType>> = new Map();

  on(event: string, handler: EventHandlerType): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  once(event: string, handler: EventHandlerType): () => void {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe();
      handler(data);
    });
    return unsubscribe;
  }

  emit(event: string, data: unknown): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in handler for event ${event}:`, e);
      }
    });
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

// ============================================================================
// Mock Addon Loader
// ============================================================================

interface MockLoadedAddon {
  id: string;
  manifest: AddonManifest;
  status: string;
  loadedAt: Date;
  components: Record<string, unknown>;
  routes: Array<{ path: string; component: () => Promise<() => null> }>;
}

/**
 * Mock addon loader for testing
 */
export class MockAddonLoader {
  private loadedAddons: Map<string, MockLoadedAddon> = new Map();
  private eventEmitter = new MockEventEmitter();

  async loadAddon(manifest: AddonManifest): Promise<MockLoadedAddon> {
    const addon: MockLoadedAddon = {
      id: manifest.id,
      manifest,
      status: 'loaded',
      loadedAt: new Date(),
      components: {},
      routes: [],
    };

    this.loadedAddons.set(manifest.id, addon);
    this.eventEmitter.emit('addon:loaded', addon);

    return addon;
  }

  async unloadAddon(id: string): Promise<void> {
    this.loadedAddons.delete(id);
    this.eventEmitter.emit('addon:unloaded', { id });
  }

  getAddon(id: string): MockLoadedAddon | undefined {
    return this.loadedAddons.get(id);
  }

  getLoadedAddons(): MockLoadedAddon[] {
    return Array.from(this.loadedAddons.values());
  }

  on(event: string, handler: EventHandlerType): () => void {
    return this.eventEmitter.on(event, handler);
  }
}

// ============================================================================
// Mock Storage
// ============================================================================

/**
 * Mock storage for testing
 */
export class MockStorage {
  private store: Map<string, unknown> = new Map();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a mock addon manifest for testing
 */
export function createMockManifest(
  overrides?: Partial<AddonManifest>,
): AddonManifest {
  return {
    $schema: 'https://openaidy.dev/schemas/addon-v1.json',
    id: 'mock-addon-' + Math.random().toString(36).slice(2, 9),
    name: 'Mock Addon',
    version: '1.0.0',
    description: 'A mock addon for testing',
    license: 'MIT',
    openaidy: {
      minVersion: '1.0.0',
    },
    entry: 'dist/index.js',
    permissions: [],
    ...overrides,
  } as AddonManifest;
}

/**
 * Reset all mocks
 */
export function resetAllMocks(): void {
  // Reset can be extended as needed
}
