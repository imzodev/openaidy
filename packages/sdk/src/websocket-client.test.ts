/**
 * WebSocket Client SDK Tests
 *
 * Tests for the WebSocket client SDK.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient, createWebSocketClient } from './websocket-client';

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static lastInstance: MockWebSocket | null = null;

  url: string;
  readyState: number = WebSocket.CONNECTING;
  private onopenHandler: (() => void) | null = null;
  private oncloseHandler:
    | ((event: { code: number; reason: string }) => void)
    | null = null;
  private onerrorHandler: ((event: Event) => void) | null = null;
  private onmessageHandler: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.lastInstance = this;
  }

  set onopen(handler: () => void) {
    this.onopenHandler = handler;
  }

  set onclose(handler: (event: { code: number; reason: string }) => void) {
    this.oncloseHandler = handler;
  }

  set onerror(handler: (event: Event) => void) {
    this.onerrorHandler = handler;
  }

  set onmessage(handler: (event: { data: string }) => void) {
    this.onmessageHandler = handler;
  }

  send(_data: string): void {
    // Track sent data if needed
  }

  close(code: number = 1000, reason: string = ''): void {
    this.readyState = WebSocket.CLOSED;
    if (this.oncloseHandler) {
      this.oncloseHandler({ code, reason });
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = WebSocket.OPEN;
    if (this.onopenHandler) {
      this.onopenHandler();
    }
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = WebSocket.CLOSED;
    if (this.oncloseHandler) {
      this.oncloseHandler({ code, reason });
    }
  }

  simulateError(): void {
    if (this.onerrorHandler) {
      this.onerrorHandler(new Event('error'));
    }
  }

  simulateMessage(data: unknown): void {
    if (this.onmessageHandler) {
      this.onmessageHandler({ data: JSON.stringify(data) });
    }
  }

  static reset(): void {
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;
  }
}

// ============================================================================
// Test Setup
// ============================================================================

const originalWebSocket = global.WebSocket;

type GlobalWithWebSocket = typeof globalThis & {
  WebSocket: typeof WebSocket;
};

describe('WebSocketClient', () => {
  let client: WebSocketClient;

  beforeEach(() => {
    MockWebSocket.reset();
    (global as GlobalWithWebSocket).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;

    client = createWebSocketClient({
      url: 'ws://localhost:3000/ws',
      autoReconnect: false,
      requestTimeout: 1000, // Short timeout for tests
    });
  });

  afterEach(() => {
    client.destroy();
    (global as GlobalWithWebSocket).WebSocket = originalWebSocket;
  });

  // ============================================================================
  // Construction
  // ============================================================================

  describe('construction', () => {
    it('should create a client instance', () => {
      expect(client).toBeDefined();
      expect(client.getState()).toBe('disconnected');
    });

    it('should not be connected initially', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should have no connection ID initially', () => {
      expect(client.getConnectionId()).toBeNull();
    });

    it('should use default options', () => {
      const defaultClient = createWebSocketClient({
        url: 'ws://localhost:3000/ws',
      });
      expect(defaultClient.getState()).toBe('disconnected');
      defaultClient.destroy();
    });

    it('should create client with factory function', () => {
      const factoryClient = createWebSocketClient({
        url: 'ws://localhost:3000/ws',
      });
      expect(factoryClient).toBeInstanceOf(WebSocketClient);
      factoryClient.destroy();
    });
  });

  // ============================================================================
  // Connection
  // ============================================================================

  describe('connection', () => {
    it('should connect to WebSocket server', async () => {
      const connectPromise = client.connect();

      expect(client.getState()).toBe('connecting');

      const mockWs = MockWebSocket.lastInstance!;
      mockWs.simulateOpen();

      await connectPromise;

      expect(client.isConnected()).toBe(true);
      expect(client.getState()).toBe('connected');
    });

    it('should disconnect from WebSocket server', async () => {
      const connectPromise = client.connect();
      MockWebSocket.lastInstance!.simulateOpen();
      await connectPromise;

      client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toBe('disconnected');
    });

    it('should handle connection errors', async () => {
      const connectPromise = client.connect();
      const mockWs = MockWebSocket.lastInstance!;

      mockWs.simulateError();

      await expect(connectPromise).rejects.toThrow('WebSocket error');
      expect(client.getState()).toBe('error');
    });

    it('should include token in URL when provided', async () => {
      const tokenClient = createWebSocketClient({
        url: 'ws://localhost:3000/ws',
        token: 'test-token-123',
      });

      const connectPromise = tokenClient.connect();
      const mockWs = MockWebSocket.lastInstance!;

      expect(mockWs.url).toContain('token=test-token-123');

      mockWs.simulateOpen();
      await connectPromise;
      tokenClient.destroy();
    });

    it('should throw when not connected', async () => {
      await expect(client.listSessions()).rejects.toThrow('Not connected');
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe('state management', () => {
    it('should emit state changes', async () => {
      const states: string[] = [];

      client.onStateChange((state) => {
        states.push(state);
      });

      const connectPromise = client.connect();
      MockWebSocket.lastInstance!.simulateOpen();
      await connectPromise;

      expect(states).toContain('connecting');
      expect(states).toContain('connected');
    });

    it('should get current state', () => {
      expect(client.getState()).toBe('disconnected');
    });
  });

  // ============================================================================
  // Event Handling
  // ============================================================================

  describe('event handling', () => {
    it('should register event handlers', () => {
      const handler = vi.fn();
      const unsubscribe = client.on('test.event', handler);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('should unregister event handlers', () => {
      const handler = vi.fn();
      client.on('test.event', handler);
      client.off('test.event', handler);
    });

    it('should handle once events', () => {
      const handler = vi.fn();
      client.once('test.event', handler);
    });

    it('should handle errors via onError', () => {
      const handler = vi.fn();
      const unsubscribe = client.onError(handler);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('should handle connection established event', async () => {
      const handler = vi.fn();
      client.on('connection.established', handler);

      const connectPromise = client.connect();
      const mockWs = MockWebSocket.lastInstance!;
      mockWs.simulateOpen();

      // Simulate connection.established message
      mockWs.simulateMessage({
        id: '1',
        type: 'connection.established',
        timestamp: new Date().toISOString(),
        payload: { connectionId: 'conn-1', heartbeatInterval: 30000 },
      });

      await connectPromise;

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
        }),
      );
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('cleanup', () => {
    it('should destroy client', async () => {
      const connectPromise = client.connect();
      MockWebSocket.lastInstance!.simulateOpen();
      await connectPromise;

      client.destroy();

      expect(client.isConnected()).toBe(false);
    });

    it('should disconnect on destroy', () => {
      client.destroy();
      expect(client.isConnected()).toBe(false);
    });
  });

  // ============================================================================
  // Options
  // ============================================================================

  describe('options', () => {
    it('should accept custom logger', () => {
      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const logClient = createWebSocketClient({
        url: 'ws://localhost:3000/ws',
        logger: customLogger,
      });

      expect(logClient).toBeDefined();
      logClient.destroy();
    });

    it('should accept client ID', () => {
      const idClient = createWebSocketClient({
        url: 'ws://localhost:3000/ws',
        clientId: 'test-client-123',
      });

      expect(idClient).toBeDefined();
      idClient.destroy();
    });
  });

  // ============================================================================
  // Method Availability
  // ============================================================================

  describe('method availability', () => {
    it('should have session methods', () => {
      expect(typeof client.createSession).toBe('function');
      expect(typeof client.getSession).toBe('function');
      expect(typeof client.listSessions).toBe('function');
      expect(typeof client.deleteSession).toBe('function');
      expect(typeof client.sendMessage).toBe('function');
      expect(typeof client.subscribeToSession).toBe('function');
      expect(typeof client.unsubscribeFromSession).toBe('function');
    });

    it('should have agent methods', () => {
      expect(typeof client.listAgents).toBe('function');
      expect(typeof client.getAgent).toBe('function');
      expect(typeof client.queryAgents).toBe('function');
    });

    it('should have provider methods', () => {
      expect(typeof client.listProviders).toBe('function');
      expect(typeof client.getProvider).toBe('function');
      expect(typeof client.getProviderModels).toBe('function');
    });

    it('should have node methods', () => {
      expect(typeof client.listNodes).toBe('function');
      expect(typeof client.getNode).toBe('function');
      expect(typeof client.invokeNode).toBe('function');
      expect(typeof client.registerNode).toBe('function');
      expect(typeof client.unregisterNode).toBe('function');
    });

    it('should have config methods', () => {
      expect(typeof client.getConfig).toBe('function');
      expect(typeof client.updateConfig).toBe('function');
      expect(typeof client.watchConfig).toBe('function');
      expect(typeof client.unwatchConfig).toBe('function');
    });

    it('should have presence methods', () => {
      expect(typeof client.updatePresence).toBe('function');
      expect(typeof client.getPresence).toBe('function');
      expect(typeof client.subscribeToPresence).toBe('function');
      expect(typeof client.unsubscribeFromPresence).toBe('function');
    });

    it('should have pairing methods', () => {
      expect(typeof client.requestPairing).toBe('function');
      expect(typeof client.getPairingStatus).toBe('function');
      expect(typeof client.approvePairing).toBe('function');
      expect(typeof client.denyPairing).toBe('function');
    });
  });
});
