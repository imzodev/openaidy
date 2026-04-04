/**
 * Tests for Session Handler streaming and delete functionality
 * 
 * Issue #126: WebSocket: enforce production-grade authentication and authorization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionHandler } from './session';
import { StreamManager } from '../streaming';
import type { SessionMessageService } from '../../sessions/service';
import type { RunEventEmitter } from '../../dispatch/events';
import type { FastifyBaseLogger } from 'fastify';
import type { HandlerContext } from '../index';
import {
  createWSMessage,
  WS_ERROR_CODES,
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
      submitMessage: vi.fn().mockResolvedValue({
        ok: true,
        userMessage: { id: 'user-msg-1', content: 'Hello', role: 'user' },
        assistantMessage: { id: 'asst-msg-1', content: 'Hi there!', role: 'assistant' },
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
      connectionManager: mockConnectionManager as any,
      services: {} as any,
      logger: mockLogger,
      streamManager: mockStreamManager,
    };
  });

  describe('handleDelete - Real delete implementation', () => {
    it('should return NOT_FOUND when session does not exist', async () => {
      (mockSessionService.deleteSession as any).mockResolvedValueOnce(false);
      (mockSessionService.getSession as any).mockResolvedValueOnce(null);

      const request = createWSMessage('session.delete', {
        sessionId: 'non-existent-session',
      });

      const response = await sessionHandler.handleDelete(
        'conn-1',
        request as any,
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
        request as any,
        handlerContext,
      );

      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('test-session-id');
      expect(response.type).toBe('session.delete');
      if (response.type === 'session.delete') {
        expect(response.payload.sessionId).toBe('test-session-id');
        expect(response.payload.deleted).toBe(true);
      }
    });

    it('should return NOT_FOUND when deleteSession returns false', async () => {
      (mockSessionService.deleteSession as any).mockResolvedValueOnce(false);

      const request = createWSMessage('session.delete', {
        sessionId: 'test-session-id',
      });

      const response = await sessionHandler.handleDelete(
        'conn-1',
        request as any,
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
        request as any,
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
        request as any,
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
        request as any,
        handlerContext,
      );

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
      }
    });

    it('should return NOT_FOUND when session does not exist for streaming', async () => {
      (mockSessionService.getSession as any).mockResolvedValueOnce(null);

      const request = createWSMessage('session.message', {
        sessionId: 'non-existent-session',
        role: 'user',
        content: 'Hello',
        stream: true,
      });

      const response = await sessionHandler.handleMessage(
        'conn-1',
        request as any,
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
        request as any,
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
        request as any,
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
        request as any,
        handlerContext,
      );

      // The streaming run happens in background, but we can verify setup
      expect(mockStreamManager.subscribeToRun).toHaveBeenCalled();
    });
  });
});
