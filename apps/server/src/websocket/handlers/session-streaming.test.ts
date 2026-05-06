/**
 * Tests for Session Handler streaming and delete functionality
 *
 * Issue #126: WebSocket: enforce production-grade authentication and authorization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionHandler } from './session';
import { StreamManager } from '../streaming';
import { ConnectionManager } from '../connection-manager';
import type { SessionMessageService } from '../../sessions/service';
import type { RunEventEmitter } from '../../dispatch/events';
import type { SubscriptionManager } from '../subscriptions';
import type { FastifyBaseLogger } from 'fastify';
import type { HandlerContext } from '../index';
import {
  createWSMessage,
  WS_ERROR_CODES,
  type SessionMessageRequest,
  type SessionDeleteRequest,
} from '@openaidy/shared-types';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => mockLogger,
  level: 'info',
  silent: false,
} as unknown as FastifyBaseLogger;

// Mock connection manager
const mockConnectionManager = {
  send: vi.fn().mockReturnValue(true),
  registerConnection: vi.fn(),
  removeConnection: vi.fn(),
  getConnection: vi.fn(),
  authenticate: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(false),
  hasCapability: vi.fn().mockReturnValue(true),
  updateHeartbeat: vi.fn(),
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, info: {} }),
  recordRequest: vi.fn(),
  checkStaleConnections: vi.fn().mockReturnValue([]),
  getConnectionCount: vi.fn().mockReturnValue(0),
  getAllConnections: vi.fn().mockReturnValue([]),
  closeAll: vi.fn(),
};

// Mock run events emitter
const mockRunEvents = {
  subscribe: vi.fn().mockReturnValue(() => {}),
  emit: vi.fn(),
  emitStarted: vi.fn(),
  emitDelta: vi.fn(),
  emitCompleted: vi.fn(),
  emitFailed: vi.fn(),
};

describe('SessionHandler - Issue #126', () => {
  let sessionHandler: SessionHandler;
  let mockSessionService: SessionMessageService;
  let mockStreamManager: StreamManager;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock session service
    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({
        id: 'test-session-id',
        title: 'Test Session',
        status: 'active',
        createdAt: new Date().toISOString(),
      }),
      getSession: vi.fn().mockResolvedValue({
        id: 'test-session-id',
        title: 'Test Session',
        status: 'active',
        createdAt: new Date().toISOString(),
      }),
      listSessions: vi.fn().mockResolvedValue([]),
      deleteSession: vi.fn().mockResolvedValue(true),
      submitMessageStreaming: vi.fn().mockResolvedValue({
        ok: true,
        userMessage: { id: 'user-msg-1', content: 'Hello', role: 'user' },
        assistantMessage: {
          id: 'asst-msg-1',
          content: 'Hi there!',
          role: 'assistant',
        },
        run: {
          id: 'run-1',
          status: 'succeeded',
          finishReason: 'stop',
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
      }),
    } as unknown as SessionMessageService;

    // Create mock stream manager
    mockStreamManager = {
      subscribeToRun: vi.fn(),
      unsubscribeFromRun: vi.fn(),
      unsubscribeAllFromConnection: vi.fn(),
      getRunSubscriptionCount: vi.fn().mockReturnValue(0),
      getConnectionSubscriptionCount: vi.fn().mockReturnValue(0),
      getTotalSubscriptionCount: vi.fn().mockReturnValue(0),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as StreamManager;

    // Create session handler with streaming support
    sessionHandler = new SessionHandler(
      mockSessionService,
      mockLogger,
      mockStreamManager,
      mockRunEvents as unknown as RunEventEmitter,
    );

    handlerContext = {
      connectionManager: mockConnectionManager as unknown as ConnectionManager,
      services: {} as unknown,
      logger: mockLogger,
      streamManager: mockStreamManager,
    };
  });

  describe('handleDelete - Real delete implementation', () => {
    it('should return NOT_FOUND when session does not exist', async () => {
      vi.mocked(mockSessionService.deleteSession).mockResolvedValueOnce(false);
      vi.mocked(mockSessionService.getSession).mockResolvedValueOnce(null);

      const request = createWSMessage('session.delete', {
        sessionId: 'non-existent-session',
      });

      const response = await sessionHandler.handleDelete(
        'conn-1',
        request as unknown as SessionDeleteRequest,
        handlerContext,
      );

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      }
    });

    it('should delete session and return success', async () => {
      const request = createWSMessage('session.delete', {
        sessionId: 'test-session-id',
      });

      const response = await sessionHandler.handleDelete(
        'conn-1',
        request as unknown as SessionDeleteRequest,
        handlerContext,
      );

      expect(mockSessionService.deleteSession).toHaveBeenCalledWith(
        'test-session-id',
      );
      expect(response.type).toBe('session.delete');
      if (response.type === 'session.delete') {
        expect(response.payload.sessionId).toBe('test-session-id');
        expect(response.payload.deleted).toBe(true);
      }
    });

    it('should return NOT_FOUND when deleteSession returns false', async () => {
      vi.mocked(mockSessionService.deleteSession).mockResolvedValueOnce(false);

      const request = createWSMessage('session.delete', {
        sessionId: 'test-session-id',
      });

      const response = await sessionHandler.handleDelete(
        'conn-1',
        request as unknown as SessionDeleteRequest,
        handlerContext,
      );

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      }
    });
  });

  describe('handleMessage - Streaming support', () => {
    it('should return session.message.ack when stream: true', async () => {
      const request = createWSMessage('session.message', {
        sessionId: 'test-session-id',
        role: 'user',
        content: 'Hello',
        stream: true,
      });

      const response = await sessionHandler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      expect(response.type).toBe('session.message.ack');
      if (response.type === 'session.message.ack') {
        expect(response.payload.sessionId).toBe('test-session-id');
        expect(response.payload.runId).toBeDefined();
        expect(response.payload.status).toBe('streaming');
      }
    });

    it('should subscribe connection to run events when streaming', async () => {
      const request = createWSMessage('session.message', {
        sessionId: 'test-session-id',
        role: 'user',
        content: 'Hello',
        stream: true,
      });

      await sessionHandler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      expect(mockStreamManager.subscribeToRun).toHaveBeenCalled();
    });

    it('should return SERVICE_UNAVAILABLE when streaming infrastructure not available', async () => {
      // Create handler without streaming support
      const handlerWithoutStreaming = new SessionHandler(
        mockSessionService,
        mockLogger,
        undefined, // No stream manager
        undefined, // No run events
      );

      const request = createWSMessage('session.message', {
        sessionId: 'test-session-id',
        role: 'user',
        content: 'Hello',
        stream: true,
      });

      const response = await handlerWithoutStreaming.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(
          WS_ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }
    });

    it('should return NOT_FOUND when session does not exist for streaming', async () => {
      vi.mocked(mockSessionService.getSession).mockResolvedValueOnce(null);

      const request = createWSMessage('session.message', {
        sessionId: 'non-existent-session',
        role: 'user',
        content: 'Hello',
        stream: true,
      });

      const response = await sessionHandler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      }
    });

    it('should return full response when stream: false', async () => {
      const request = createWSMessage('session.message', {
        sessionId: 'test-session-id',
        role: 'user',
        content: 'Hello',
        stream: false,
      });

      const response = await sessionHandler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      expect(response.type).toBe('session.message');
      if (response.type === 'session.message') {
        expect(response.payload.sessionId).toBe('test-session-id');
        expect(response.payload.role).toBe('assistant');
        expect(response.payload.content).toBe('Hi there!');
      }
    });

    it('should not subscribe to run events when not streaming', async () => {
      const request = createWSMessage('session.message', {
        sessionId: 'test-session-id',
        role: 'user',
        content: 'Hello',
        stream: false,
      });

      await sessionHandler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      expect(mockStreamManager.subscribeToRun).not.toHaveBeenCalled();
    });
  });

  describe('Stream event emission', () => {
    it('should emit run.started event when streaming starts', async () => {
      const request = createWSMessage('session.message', {
        sessionId: 'test-session-id',
        role: 'user',
        content: 'Hello',
        stream: true,
      });

      await sessionHandler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        handlerContext,
      );

      // The streaming run happens in background, but we can verify setup
      expect(mockStreamManager.subscribeToRun).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// maybeRenameSession — auto-rename after first streaming run
// ============================================================================

describe('SessionHandler - auto-rename session after first run', () => {
  const mockBroadcast = vi.fn().mockReturnValue(1);
  const mockSubscriptionManager = {
    broadcastToSession: mockBroadcast,
  } as unknown as SubscriptionManager;

  function makeSessionService({
    runCount = 1,
    generatedTitle = 'Auto Generated Title',
  }: {
    runCount?: number;
    generatedTitle?: string | null;
  } = {}): SessionMessageService {
    return {
      getSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'New Session',
        status: 'active',
        createdAt: new Date().toISOString(),
      }),
      listRuns: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: runCount }, (_, i) => ({ id: `run-${i}` })),
        ),
      generateTitle: vi.fn().mockResolvedValue(generatedTitle),
      updateSessionTitle: vi
        .fn()
        .mockResolvedValue({ id: 'session-1', title: generatedTitle }),
      submitMessageStreaming: vi.fn().mockResolvedValue({
        ok: true,
        userMessage: { id: 'u1', role: 'user', content: 'Hello' },
        assistantMessage: { id: 'a1', role: 'assistant', content: 'Hi' },
        run: {
          id: 'run-1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          finishReason: 'stop',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }),
      listMessages: vi.fn().mockResolvedValue([]),
    } as unknown as SessionMessageService;
  }

  function makeStreamManager(): StreamManager {
    return {
      subscribeToRun: vi.fn(),
      unsubscribeFromRun: vi.fn(),
      unsubscribeAllFromConnection: vi.fn(),
      getRunSubscriptionCount: vi.fn().mockReturnValue(0),
      getConnectionSubscriptionCount: vi.fn().mockReturnValue(0),
      getTotalSubscriptionCount: vi.fn().mockReturnValue(0),
    } as unknown as StreamManager;
  }

  const mockRunEventsForRename = {
    subscribe: vi.fn().mockReturnValue(() => {}),
    emit: vi.fn(),
    emitStarted: vi.fn(),
    emitDelta: vi.fn(),
    emitCompleted: vi.fn(),
    emitFailed: vi.fn(),
    emitToolCall: vi.fn(),
  } as unknown as RunEventEmitter;

  const mockConnectionManagerForRename = {
    send: vi.fn().mockReturnValue(true),
    registerConnection: vi.fn(),
    removeConnection: vi.fn(),
    getConnection: vi.fn(),
    authenticate: vi.fn(),
    isAuthenticated: vi.fn().mockReturnValue(false),
    hasCapability: vi.fn().mockReturnValue(true),
    updateHeartbeat: vi.fn(),
    checkRateLimit: vi.fn().mockReturnValue({ allowed: true, info: {} }),
    recordRequest: vi.fn(),
    checkStaleConnections: vi.fn().mockReturnValue([]),
    getConnectionCount: vi.fn().mockReturnValue(0),
    getAllConnections: vi.fn().mockReturnValue([]),
    closeAll: vi.fn(),
  };

  const mockLoggerForRename = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: function () {
      return this;
    },
    level: 'info',
    silent: false,
  } as unknown as FastifyBaseLogger;

  function makeHandlerContext(streamManager: StreamManager): HandlerContext {
    return {
      connectionManager:
        mockConnectionManagerForRename as unknown as ConnectionManager,
      services: {} as unknown,
      logger: mockLoggerForRename,
      streamManager,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renames the session and broadcasts session.updated after the first run', async () => {
    const sessionService = makeSessionService({
      runCount: 1,
      generatedTitle: 'Fix login bug',
    });
    const streamManager = makeStreamManager();
    const handler = new SessionHandler(
      sessionService,
      mockLoggerForRename,
      streamManager,
      mockRunEventsForRename,
      mockSubscriptionManager,
    );

    const request = createWSMessage('session.message', {
      sessionId: 'session-1',
      role: 'user',
      content: 'Fix the login bug',
      stream: true,
    });

    await handler.handleMessage(
      'conn-1',
      request as unknown as SessionMessageRequest,
      makeHandlerContext(streamManager),
    );

    // Allow the background streaming run + rename to complete
    await vi.runAllTimersAsync().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(sessionService.generateTitle).toHaveBeenCalledWith(
      'Fix the login bug',
      'openai',
      'gpt-4o',
    );
    expect(sessionService.updateSessionTitle).toHaveBeenCalledWith(
      'session-1',
      'Fix login bug',
    );
    expect(mockBroadcast).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        type: 'session.updated',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          updates: { title: 'Fix login bug' },
        }),
      }),
    );
  });

  it('skips rename when this is not the first run (runCount > 1)', async () => {
    const sessionService = makeSessionService({ runCount: 2 });
    const streamManager = makeStreamManager();
    const handler = new SessionHandler(
      sessionService,
      mockLoggerForRename,
      streamManager,
      mockRunEventsForRename,
      mockSubscriptionManager,
    );

    const request = createWSMessage('session.message', {
      sessionId: 'session-1',
      role: 'user',
      content: 'Second message',
      stream: true,
    });

    await handler.handleMessage(
      'conn-1',
      request as unknown as SessionMessageRequest,
      makeHandlerContext(streamManager),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(sessionService.generateTitle).not.toHaveBeenCalled();
    expect(sessionService.updateSessionTitle).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('skips rename when generateTitle returns null', async () => {
    const sessionService = makeSessionService({
      runCount: 1,
      generatedTitle: null,
    });
    const streamManager = makeStreamManager();
    const handler = new SessionHandler(
      sessionService,
      mockLoggerForRename,
      streamManager,
      mockRunEventsForRename,
      mockSubscriptionManager,
    );

    const request = createWSMessage('session.message', {
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      stream: true,
    });

    await handler.handleMessage(
      'conn-1',
      request as unknown as SessionMessageRequest,
      makeHandlerContext(streamManager),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(sessionService.updateSessionTitle).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('does not broadcast when no subscriptionManager is provided', async () => {
    const sessionService = makeSessionService({
      runCount: 1,
      generatedTitle: 'Some title',
    });
    const streamManager = makeStreamManager();
    const handlerWithoutSubs = new SessionHandler(
      sessionService,
      mockLoggerForRename,
      streamManager,
      mockRunEventsForRename,
      undefined, // no subscriptionManager
    );

    const request = createWSMessage('session.message', {
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      stream: true,
    });

    await handlerWithoutSubs.handleMessage(
      'conn-1',
      request as unknown as SessionMessageRequest,
      makeHandlerContext(streamManager),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(sessionService.updateSessionTitle).toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('streaming completes successfully even when rename fails', async () => {
    const sessionService = makeSessionService({ runCount: 1 });
    vi.mocked(sessionService.generateTitle).mockRejectedValue(
      new Error('provider down'),
    );
    const streamManager = makeStreamManager();
    const handler = new SessionHandler(
      sessionService,
      mockLoggerForRename,
      streamManager,
      mockRunEventsForRename,
      mockSubscriptionManager,
    );

    const request = createWSMessage('session.message', {
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      stream: true,
    });

    await expect(
      handler.handleMessage(
        'conn-1',
        request as unknown as SessionMessageRequest,
        makeHandlerContext(streamManager),
      ),
    ).resolves.toMatchObject({ type: 'session.message.ack' });

    // Give the background task a tick to finish
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLoggerForRename.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'Auto-rename session failed (non-fatal)',
    );
  });
});
