import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StreamManager,
  createStreamManager,
  mapRunEventToStreamEvent,
} from './streaming';
import type { RunEvent, RunEventEmitter } from '../dispatch/events';
import type { ConnectionManager } from './connection-manager';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
};

// Mock ConnectionManager
const createMockConnectionManager = () => ({
  send: vi.fn().mockReturnValue(true),
  registerConnection: vi.fn(),
  removeConnection: vi.fn(),
  getConnection: vi.fn(),
  getAllConnections: vi.fn().mockReturnValue([]),
  getConnectionCount: vi.fn().mockReturnValue(0),
  hasConnection: vi.fn().mockReturnValue(true),
  authenticate: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(true),
  getCapabilities: vi.fn().mockReturnValue([]),
  hasCapability: vi.fn().mockReturnValue(true),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  unsubscribeAll: vi.fn(),
  getSubscribers: vi.fn().mockReturnValue([]),
  getSubscriptions: vi.fn().mockReturnValue([]),
  updateHeartbeat: vi.fn(),
  checkStaleConnections: vi.fn().mockReturnValue([]),
  getLastHeartbeat: vi.fn(),
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, info: { remaining: 10, reset: Date.now(), limit: 100 } }),
  recordRequest: vi.fn(),
  resetRateLimit: vi.fn(),
  closeAll: vi.fn(),
});

// Mock RunEventEmitter
const createMockRunEventEmitter = () => {
  const listeners: Map<string, Set<(event: RunEvent) => void>> = new Map();

  return {
    subscribe: vi.fn((runId: string, listener: (event: RunEvent) => void) => {
      if (!listeners.has(runId)) {
        listeners.set(runId, new Set());
      }
      listeners.get(runId)!.add(listener);

      return () => {
        listeners.get(runId)?.delete(listener);
      };
    }),
    emit: vi.fn((event: RunEvent) => {
      listeners.get(event.runId)?.forEach((listener) => listener(event));
    }),
    emitQueued: vi.fn(),
    emitStarted: vi.fn(),
    emitDelta: vi.fn(),
    emitCompleted: vi.fn(),
    emitFailed: vi.fn(),
    clear: vi.fn(),
    listenerCount: vi.fn((runId: string) => listeners.get(runId)?.size ?? 0),
  };
};

describe('mapRunEventToStreamEvent', () => {
  it('should map run.started event', () => {
    const event: RunEvent = {
      type: 'run.started',
      runId: 'run-123',
      sessionId: 'session-456',
      agentId: 'agent-789',
      timestamp: '2024-01-01T00:00:00.000Z',
      data: {
        providerId: 'provider-1',
        modelId: 'model-1',
      },
    };

    const result = mapRunEventToStreamEvent(event);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('session.stream.start');
    expect(result?.payload.runId).toBe('run-123');
    expect(result?.payload.sessionId).toBe('session-456');
    expect(result?.payload.providerId).toBe('provider-1');
    expect(result?.payload.modelId).toBe('model-1');
  });

  it('should map run.delta event', () => {
    const event: RunEvent = {
      type: 'run.delta',
      runId: 'run-123',
      sessionId: 'session-456',
      agentId: 'agent-789',
      timestamp: '2024-01-01T00:00:01.000Z',
      data: {
        delta: 'Hello',
        content: 'Hello world',
      },
    };

    const result = mapRunEventToStreamEvent(event);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('session.stream.delta');
    expect(result?.payload.delta).toBe('Hello');
    expect(result?.payload.content).toBe('Hello world');
  });

  it('should map run.completed event', () => {
    const event: RunEvent = {
      type: 'run.completed',
      runId: 'run-123',
      sessionId: 'session-456',
      agentId: 'agent-789',
      timestamp: '2024-01-01T00:00:30.000Z',
      data: {
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      },
    };

    const result = mapRunEventToStreamEvent(event);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('session.stream.end');
    expect(result?.payload.finishReason).toBe('stop');
  });

  it('should map run.failed event', () => {
    const event: RunEvent = {
      type: 'run.failed',
      runId: 'run-123',
      sessionId: 'session-456',
      agentId: 'agent-789',
      timestamp: '2024-01-01T00:00:10.000Z',
      data: {
        errorCode: 'provider.error',
        errorMessage: 'API rate limit exceeded',
      },
    };

    const result = mapRunEventToStreamEvent(event);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('session.stream.error');
    expect(result?.payload.error.code).toBe('provider.error');
    expect(result?.payload.error.message).toBe('API rate limit exceeded');
  });

  it('should handle run.failed with missing error info', () => {
    const event: RunEvent = {
      type: 'run.failed',
      runId: 'run-123',
      sessionId: 'session-456',
      agentId: 'agent-789',
      timestamp: '2024-01-01T00:00:10.000Z',
      data: {},
    };

    const result = mapRunEventToStreamEvent(event);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('session.stream.error');
    expect(result?.payload.error.code).toBe('unknown_error');
    expect(result?.payload.error.message).toBe('Unknown error');
  });

  it('should return null for unknown event types', () => {
    const event = {
      type: 'unknown.event',
      runId: 'run-123',
      sessionId: 'session-456',
      agentId: 'agent-789',
      timestamp: '2024-01-01T00:00:00.000Z',
      data: {},
    } as RunEvent;

    const result = mapRunEventToStreamEvent(event);

    expect(result).toBeNull();
  });
});

describe('StreamManager', () => {
  let manager: StreamManager;
  let mockRunEvents: ReturnType<typeof createMockRunEventEmitter>;
  let mockConnectionManager: ReturnType<typeof createMockConnectionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunEvents = createMockRunEventEmitter();
    mockConnectionManager = createMockConnectionManager();
    manager = new StreamManager(
      mockRunEvents as unknown as RunEventEmitter,
      mockConnectionManager as unknown as ConnectionManager,
      mockLogger as any,
    );
  });

  describe('subscribeToRun', () => {
    it('should subscribe to run events', () => {
      manager.subscribeToRun('run-123', 'conn-1');

      expect(mockRunEvents.subscribe).toHaveBeenCalledWith('run-123', expect.any(Function));
      expect(manager.getRunSubscriptionCount('run-123')).toBe(1);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(1);
    });

    it('should not duplicate subscriptions', () => {
      manager.subscribeToRun('run-123', 'conn-1');
      manager.subscribeToRun('run-123', 'conn-1');

      expect(mockRunEvents.subscribe).toHaveBeenCalledTimes(1);
      expect(manager.getRunSubscriptionCount('run-123')).toBe(1);
    });

    it('should allow multiple connections to same run', () => {
      manager.subscribeToRun('run-123', 'conn-1');
      manager.subscribeToRun('run-123', 'conn-2');

      expect(manager.getRunSubscriptionCount('run-123')).toBe(2);
    });

    it('should allow a connection to subscribe to multiple runs', () => {
      manager.subscribeToRun('run-1', 'conn-1');
      manager.subscribeToRun('run-2', 'conn-1');

      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(2);
    });
  });

  describe('unsubscribeFromRun', () => {
    it('should unsubscribe from run events', () => {
      manager.subscribeToRun('run-123', 'conn-1');
      manager.unsubscribeFromRun('run-123', 'conn-1');

      expect(manager.getRunSubscriptionCount('run-123')).toBe(0);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(0);
    });

    it('should handle unsubscribing non-existent subscription', () => {
      // Should not throw
      manager.unsubscribeFromRun('run-123', 'conn-1');

      expect(manager.getRunSubscriptionCount('run-123')).toBe(0);
    });
  });

  describe('unsubscribeAllFromConnection', () => {
    it('should unsubscribe connection from all runs', () => {
      manager.subscribeToRun('run-1', 'conn-1');
      manager.subscribeToRun('run-2', 'conn-1');
      manager.subscribeToRun('run-3', 'conn-1');

      manager.unsubscribeAllFromConnection('conn-1');

      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(0);
      expect(manager.getRunSubscriptionCount('run-1')).toBe(0);
      expect(manager.getRunSubscriptionCount('run-2')).toBe(0);
      expect(manager.getRunSubscriptionCount('run-3')).toBe(0);
    });

    it('should handle connection with no subscriptions', () => {
      // Should not throw
      manager.unsubscribeAllFromConnection('conn-1');
    });
  });

  describe('event handling', () => {
    it('should forward run.started event to subscribed connection', () => {
      manager.subscribeToRun('run-123', 'conn-1');

      // Emit event
      const event: RunEvent = {
        type: 'run.started',
        runId: 'run-123',
        sessionId: 'session-456',
        agentId: 'agent-789',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          providerId: 'provider-1',
          modelId: 'model-1',
        },
      };
      mockRunEvents.emit(event);

      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({
          type: 'session.stream.start',
        }),
      );
    });

    it('should forward run.delta event to subscribed connection', () => {
      manager.subscribeToRun('run-123', 'conn-1');

      const event: RunEvent = {
        type: 'run.delta',
        runId: 'run-123',
        sessionId: 'session-456',
        agentId: 'agent-789',
        timestamp: '2024-01-01T00:00:01.000Z',
        data: {
          delta: 'Hello',
          content: 'Hello world',
        },
      };
      mockRunEvents.emit(event);

      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({
          type: 'session.stream.delta',
        }),
      );
    });

    it('should not forward events to unsubscribed connections', () => {
      manager.subscribeToRun('run-123', 'conn-1');
      manager.unsubscribeFromRun('run-123', 'conn-1');

      const event: RunEvent = {
        type: 'run.started',
        runId: 'run-123',
        sessionId: 'session-456',
        agentId: 'agent-789',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {},
      };
      mockRunEvents.emit(event);

      // Should not send since unsubscribed
      expect(mockConnectionManager.send).not.toHaveBeenCalled();
    });

    it('should auto-unsubscribe on run.completed', () => {
      manager.subscribeToRun('run-123', 'conn-1');

      const event: RunEvent = {
        type: 'run.completed',
        runId: 'run-123',
        sessionId: 'session-456',
        agentId: 'agent-789',
        timestamp: '2024-01-01T00:00:30.000Z',
        data: { finishReason: 'stop' },
      };
      mockRunEvents.emit(event);

      // Should be auto-unsubscribed
      expect(manager.getRunSubscriptionCount('run-123')).toBe(0);
    });

    it('should auto-unsubscribe on run.failed', () => {
      manager.subscribeToRun('run-123', 'conn-1');

      const event: RunEvent = {
        type: 'run.failed',
        runId: 'run-123',
        sessionId: 'session-456',
        agentId: 'agent-789',
        timestamp: '2024-01-01T00:00:10.000Z',
        data: {
          errorCode: 'error',
          errorMessage: 'Failed',
        },
      };
      mockRunEvents.emit(event);

      // Should be auto-unsubscribed
      expect(manager.getRunSubscriptionCount('run-123')).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('should start and stop correctly', () => {
      manager.start();
      expect(manager.running).toBe(true);

      manager.stop();
      expect(manager.running).toBe(false);
    });

    it('should clear all subscriptions on stop', () => {
      manager.subscribeToRun('run-1', 'conn-1');
      manager.subscribeToRun('run-2', 'conn-2');

      manager.stop();

      expect(manager.getTotalSubscriptionCount()).toBe(0);
    });
  });

  describe('subscription counts', () => {
    it('should track subscription counts correctly', () => {
      expect(manager.getTotalSubscriptionCount()).toBe(0);

      manager.subscribeToRun('run-1', 'conn-1');
      expect(manager.getTotalSubscriptionCount()).toBe(1);

      manager.subscribeToRun('run-2', 'conn-1');
      expect(manager.getTotalSubscriptionCount()).toBe(2);

      manager.unsubscribeFromRun('run-1', 'conn-1');
      expect(manager.getTotalSubscriptionCount()).toBe(1);
    });
  });
});

describe('createStreamManager', () => {
  it('should create a StreamManager instance', () => {
    const mockRunEvents = createMockRunEventEmitter();
    const mockConnectionManager = createMockConnectionManager();

    const manager = createStreamManager(
      mockRunEvents as unknown as RunEventEmitter,
      mockConnectionManager as unknown as ConnectionManager,
      mockLogger as any,
    );

    expect(manager).toBeInstanceOf(StreamManager);
  });
});
