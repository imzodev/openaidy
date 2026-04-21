/**
 * Addon Testing Utilities
 *
 * Test fixtures, mocks, and helper functions for addon testing.
 */

import type { AddonManifest, AddonPermission } from '@openaidy/shared-types';

// ============================================================================
// Mock Manifest Factory
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
 * Create a minimal mock manifest
 */
export function createMinimalMockManifest(): AddonManifest {
  return createMockManifest({
    id: 'minimal-addon',
    name: 'Minimal Addon',
    version: '0.0.1',
    description: 'A minimal addon for testing',
  });
}

// ============================================================================
// Mock Addon Factory
// ============================================================================

import type { LoadedAddon } from '../addon-types';

/**
 * Create a mock loaded addon for testing
 */
export function createMockAddon(overrides?: Partial<LoadedAddon>): LoadedAddon {
  return {
    id: 'mock-addon-' + Math.random().toString(36).slice(2, 9),
    manifest: createMockManifest(),
    status: 'loaded',
    loadedAt: new Date(),
    components: {},
    routes: [],
    ...overrides,
  } as LoadedAddon;
}

// ============================================================================
// Mock Permission Factory
// ============================================================================

/**
 * Create a mock permission string
 */
export function createMockPermission(
  resource: string,
  action: string,
  scope?: string,
): AddonPermission {
  const base = `${resource}.${action}` as AddonPermission;
  return scope ? (`${base}:${scope}` as AddonPermission) : base;
}

/**
 * Create a set of common mock permissions
 */
export function createCommonMockPermissions(): AddonPermission[] {
  return [
    createMockPermission('agents', 'invoke'),
    createMockPermission('sessions', 'read'),
    createMockPermission('config', 'read'),
  ];
}

// ============================================================================
// Mock API Responses
// ============================================================================

/**
 * Create a mock agent invocation response
 */
export function createMockAgentInvocationResponse() {
  return {
    response: 'This is a mock response from the agent.',
    sessionId: 'mock-session-' + Math.random().toString(36).slice(2, 9),
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    metadata: {},
  };
}

/**
 * Create a mock session list
 */
export function createMockSessionList(count: number = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i + 1}`,
    title: `Mock Session ${i + 1}`,
    status: 'active' as const,
    createdAt: new Date(Date.now() - i * 60000).toISOString(),
    updatedAt: new Date(Date.now() - i * 30000).toISOString(),
    messageCount: Math.floor(Math.random() * 50),
  }));
}

// ============================================================================
// Mock Runtime API
// ============================================================================

/**
 * Create a mock addon runtime for testing
 */
export function createMockAddonRuntime(
  overrides?: Partial<import('../addon-types').AddonRuntime>,
) {
  return {
    addon: {
      id: 'mock-addon',
      name: 'Mock Addon',
      version: '1.0.0',
      permissions: ['agents:invoke', 'sessions:read'],
    },
    agents: {
      invoke: async () => createMockAgentInvocationResponse(),
      listAgents: async () => [],
      getAgentCapabilities: async () => ({ streaming: true }),
    },
    sessions: {
      list: async () => createMockSessionList(),
      get: async () => null,
      create: async () => ({
        id: 'new-session',
        title: 'New Session',
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      delete: async () => undefined,
    },
    config: {
      get: async () => ({}),
      getKey: async () => null,
      listNamespaces: async () => [],
    },
    utils: {
      notify: () => {},
      formatDate: () => 'Jan 1, 2024',
      formatRelativeTime: () => 'just now',
      copyToClipboard: async () => {},
    },
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    },
    events: {
      on: () => () => {},
      emit: () => {},
      once: () => () => {},
    },
    ...overrides,
  };
}

// ============================================================================
// Test Setup Utilities
// ============================================================================

/** Extended window interface for addon runtime */
interface AddonWindow extends Window {
  __ADDON_RUNTIME__?: ReturnType<typeof createMockAddonRuntime>;
}

/**
 * Setup mock window for addon testing
 */
export function setupMockWindowAddon() {
  const runtime = createMockAddonRuntime();
  (window as AddonWindow).__ADDON_RUNTIME__ = runtime;
  return runtime;
}

/**
 * Cleanup mock window
 */
export function cleanupMockWindowAddon() {
  delete (window as AddonWindow).__ADDON_RUNTIME__;
}

// ============================================================================
// Async Test Helpers
// ============================================================================

/**
 * Wait for a condition to be true
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout: number = 1000,
  interval: number = 50,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Flush all pending promises
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Mock Addon Component
// ============================================================================

/**
 * Create a mock addon component
 */
export function createMockAddonComponent(name: string) {
  return {
    name,
    component: async () => () => null,
    metadata: { createdAt: new Date().toISOString() },
  };
}

// ============================================================================
// Mock Route
// ============================================================================

/**
 * Create a mock addon route
 */
export function createMockAddonRoute(path: string) {
  return {
    path,
    component: async () => () => null,
    metadata: {
      title: `Route: ${path}`,
      order: 0,
    },
  };
}
