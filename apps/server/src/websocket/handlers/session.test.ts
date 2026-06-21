import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionHandler,
  createSessionHandler,
  registerSessionHandlers,
} from './session';
import { SessionMessageService } from '../../sessions/service';
import {
  type Session,
  type SessionMessage,
  type SessionRun,
} from '@openaidy/db';
import {
  createWSMessage,
  WS_ERROR_CODES,
  type SessionCreateRequest,
  type SessionGetRequest,
  type SessionListRequest,
  type SessionDeleteRequest,
  type SessionMessageRequest,
} from '@openaidy/shared-types';
import type { HandlerContext } from '../message-router';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
  level: 'info',
  silent: vi.fn(),
};

// Mock context
const mockContext = {
  connectionManager: {
    getConnection: vi.fn(),
    hasCapability: vi.fn().mockReturnValue(true),
  },
  services: {},
  logger: mockLogger,
} as unknown as HandlerContext;

describe('SessionHandler', () => {
  let handler: SessionHandler;
  let mockSessionService: {
    createSession: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    deleteSession: ReturnType<typeof vi.fn>;
    submitMessage?: ReturnType<typeof vi.fn>;
    submitMessageStreaming: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessionService = {
      createSession: vi.fn(),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      submitMessageStreaming: vi.fn(),
    };

    handler = new SessionHandler(
      mockSessionService as unknown as SessionMessageService,
      mockLogger,
    );
  });

  describe('handleCreate', () => {
    it('should create a session and return response', async () => {
      const mockSession: Session = {
        id: 'session-123',
        title: 'Session 2024-01-01T00:00:00.000Z',
        type: 'chat',
        status: 'active',
        agentId: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        archivedAt: null,
      };
      mockSessionService.createSession.mockResolvedValue(mockSession);

      const request = createWSMessage('session.create', {
        agentId: 'agent-1',
      }) as SessionCreateRequest;

      const response = await handler.handleCreate(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('session.created');
      expect(
        (response as { payload: { sessionId: string } }).payload.sessionId,
      ).toBe('session-123');
      expect(mockSessionService.createSession).toHaveBeenCalled();
    });

    it('should handle create errors', async () => {
      mockSessionService.createSession.mockRejectedValue(new Error('DB error'));

      const request = createWSMessage(
        'session.create',
        {},
      ) as SessionCreateRequest;

      const response = await handler.handleCreate(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('error');
      expect(
        (response as unknown as { payload: { error: { code: string } } })
          .payload.error.code,
      ).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
    });
  });

  describe('handleGet', () => {
    it('should return session if found', async () => {
      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        type: 'chat',
        status: 'active',
        agentId: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:01:00.000Z'),
        archivedAt: null,
      };
      mockSessionService.getSession.mockResolvedValue(mockSession);

      const request = createWSMessage('session.get', {
        sessionId: 'session-123',
      }) as SessionGetRequest;

      const response = await handler.handleGet('conn-1', request, mockContext);

      expect(response.type).toBe('session.get');
      expect(
        (response as { payload: { session: { id: string; title: string } } })
          .payload.session.id,
      ).toBe('session-123');
      expect(
        (response as { payload: { session: { id: string; title: string } } })
          .payload.session.title,
      ).toBe('Test Session');
    });

    it('should return NOT_FOUND error if session does not exist', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = createWSMessage('session.get', {
        sessionId: 'nonexistent',
      }) as SessionGetRequest;

      const response = await handler.handleGet('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      expect(
        (response as { payload: { error: { code: string } } }).payload.error
          .code,
      ).toBe(WS_ERROR_CODES.NOT_FOUND);
    });
  });

  describe('handleList', () => {
    it('should return list of sessions', async () => {
      const mockSessions: Session[] = [
        {
          id: 'session-1',
          title: 'Session 1',
          type: 'chat',
          status: 'active',
          agentId: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null,
        },
        {
          id: 'session-2',
          title: 'Session 2',
          type: 'chat',
          status: 'active',
          agentId: null,
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          archivedAt: null,
        },
      ];
      mockSessionService.listSessions.mockResolvedValue(mockSessions);

      const request = createWSMessage('session.list', {}) as SessionListRequest;

      const response = await handler.handleList('conn-1', request, mockContext);

      expect(response.type).toBe('session.list');
      expect(
        (
          response as unknown as {
            payload: { sessions: Session[]; total: number };
          }
        ).payload.sessions,
      ).toHaveLength(2);
      expect(
        (
          response as unknown as {
            payload: { sessions: Session[]; total: number };
          }
        ).payload.total,
      ).toBe(2);
    });

    it('should filter by status', async () => {
      const mockSessions: Session[] = [
        {
          id: 'session-1',
          title: 'Session 1',
          type: 'chat',
          status: 'active',
          agentId: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null,
        },
        {
          id: 'session-2',
          title: 'Session 2',
          type: 'chat',
          status: 'archived',
          agentId: null,
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          archivedAt: new Date('2024-01-02T00:00:00.000Z'),
        },
      ];
      mockSessionService.listSessions.mockResolvedValue(mockSessions);

      const request = createWSMessage('session.list', {
        status: 'active',
      }) as SessionListRequest;

      const response = await handler.handleList('conn-1', request, mockContext);

      expect(
        (response as unknown as { payload: { sessions: Session[] } }).payload
          .sessions,
      ).toHaveLength(1);
      expect(
        (response as unknown as { payload: { sessions: Session[] } }).payload
          .sessions[0]!.status,
      ).toBe('active');
    });

    it('should apply pagination', async () => {
      const mockSessions: Session[] = Array.from({ length: 100 }, (_, i) => ({
        id: `session-${i}`,
        title: `Session ${i}`,
        type: 'chat' as const,
        status: 'active' as const,
        agentId: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        archivedAt: null,
      }));
      mockSessionService.listSessions.mockResolvedValue(mockSessions);

      const request = createWSMessage('session.list', {
        offset: 10,
        limit: 10,
      }) as SessionListRequest;

      const response = await handler.handleList('conn-1', request, mockContext);

      expect(
        (
          response as unknown as {
            payload: { sessions: Session[]; total: number };
          }
        ).payload.sessions,
      ).toHaveLength(10);
      expect(
        (
          response as unknown as {
            payload: { sessions: Session[]; total: number };
          }
        ).payload.total,
      ).toBe(100);
    });
  });

  describe('handleDelete', () => {
    it('should return success for existing session', async () => {
      mockSessionService.deleteSession.mockResolvedValue(true);

      const request = createWSMessage('session.delete', {
        sessionId: 'session-123',
      }) as SessionDeleteRequest;

      const response = await handler.handleDelete(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('session.delete');
      expect(
        (response as { payload: { sessionId: string; deleted: boolean } })
          .payload.sessionId,
      ).toBe('session-123');
      expect(
        (response as { payload: { sessionId: string; deleted: boolean } })
          .payload.deleted,
      ).toBe(true);
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith(
        'session-123',
      );
    });

    it('should return NOT_FOUND error if session does not exist', async () => {
      mockSessionService.deleteSession.mockResolvedValue(false);

      const request = createWSMessage('session.delete', {
        sessionId: 'nonexistent',
      }) as SessionDeleteRequest;

      const response = await handler.handleDelete(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('error');
      expect(
        (response as { payload: { error: { code: string } } }).payload.error
          .code,
      ).toBe(WS_ERROR_CODES.NOT_FOUND);
    });
  });

  describe('handleMessage', () => {
    it('should submit message and return response', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'session-123',
        status: 'active',
        runId: null,
        reasoningContent: null,
        firstMessageId: null,
        metadata: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        title: 'Mock Session',
        type: 'chat',
        archivedAt: null,
      });

      const userMessage: SessionMessage = {
        id: 'msg-1',
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        toolCallId: null,
        sequence: 1,
        metadata: null,
        runId: null,
        reasoningContent: null,
      };

      const assistantMessage: SessionMessage = {
        id: 'msg-2',
        sessionId: 'session-123',
        role: 'assistant',
        content: 'Hi there!',
        createdAt: new Date('2024-01-01T00:00:01.000Z'),
        toolCallId: null,
        sequence: 2,
        metadata: null,
        runId: null,
        reasoningContent: null,
      };

      const run: SessionRun = {
        id: 'run-1',
        sessionId: 'session-123',
        agentId: 'agent-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        status: 'succeeded',
        finishReason: 'stop',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        metadata: null,
        startedAt: null,
        finishedAt: new Date('2024-01-01T00:00:01.000Z'),
        errorCode: null,
        errorMessage: null,
        firstMessageId: null,
      };

      mockSessionService.submitMessageStreaming.mockResolvedValue({
        ok: true,
        userMessage,
        assistantMessage,
        run,
      });

      const request = createWSMessage('session.message', {
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
      }) as SessionMessageRequest;

      const response = await handler.handleMessage(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('session.message');
      expect(
        (
          response as {
            payload: {
              sessionId: string;
              messageId: string;
              role: string;
              content: string;
              usage: { totalTokens: number };
            };
          }
        ).payload.sessionId,
      ).toBe('session-123');
      expect(
        (
          response as {
            payload: {
              sessionId: string;
              messageId: string;
              role: string;
              content: string;
              usage: { totalTokens: number };
            };
          }
        ).payload.messageId,
      ).toBe('msg-2');
      expect(
        (
          response as {
            payload: {
              sessionId: string;
              messageId: string;
              role: string;
              content: string;
              usage: { totalTokens: number };
            };
          }
        ).payload.role,
      ).toBe('assistant');
      expect(
        (
          response as {
            payload: {
              sessionId: string;
              messageId: string;
              role: string;
              content: string;
              usage: { totalTokens: number };
            };
          }
        ).payload.content,
      ).toBe('Hi there!');
      expect(
        (
          response as {
            payload: {
              sessionId: string;
              messageId: string;
              role: string;
              content: string;
              usage: { totalTokens: number };
            };
          }
        ).payload.usage.totalTokens,
      ).toBe(30);
    });

    it('should return SERVICE_UNAVAILABLE for streaming requests when streaming not configured', async () => {
      // Handler is created without streamManager/runEvents in beforeEach
      const request = createWSMessage('session.message', {
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
        stream: true,
      }) as SessionMessageRequest;

      const response = await handler.handleMessage(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('error');
      expect(
        (response as unknown as { payload: { error: { code: string } } })
          .payload.error.code,
      ).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
    });

    it('should handle submit errors', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'session-123',
        status: 'active',
        runId: null,
        reasoningContent: null,
        firstMessageId: null,
        metadata: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        title: 'Mock Session',
        type: 'chat',
        archivedAt: null,
      });

      mockSessionService.submitMessageStreaming.mockResolvedValue({
        ok: false,
        error: {
          code: 'provider.error',
          message: 'Provider failed',
        },
      });

      const request = createWSMessage('session.message', {
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
      }) as SessionMessageRequest;

      const response = await handler.handleMessage(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('error');
      expect(
        (response as unknown as { payload: { error: { message: string } } })
          .payload.error.message,
      ).toBe('Provider failed');
    });
  });
});

describe('createSessionHandler', () => {
  it('should create handler instance', () => {
    const mockService = {} as SessionMessageService;
    const handler = createSessionHandler(mockService, mockLogger);

    expect(handler).toBeInstanceOf(SessionHandler);
  });
});

describe('registerSessionHandlers', () => {
  it('should register all session handlers', () => {
    const mockRouter = {
      registerHandler: vi.fn(),
    };

    const mockService = {} as SessionMessageService;
    const handler = createSessionHandler(mockService, mockLogger);

    registerSessionHandlers(mockRouter, handler);

    expect(mockRouter.registerHandler).toHaveBeenCalledTimes(7);
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.create',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.get',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.list',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.delete',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.message',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.messages',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'session.runs',
      expect.any(Function),
    );
  });
});

// ============================================================================
// Streaming Tests
// ============================================================================

describe('SessionHandler Streaming', () => {
  let handler: SessionHandler;
  let mockSessionService: {
    createSession: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    deleteSession: ReturnType<typeof vi.fn>;
    submitMessage?: ReturnType<typeof vi.fn>;
    submitMessageStreaming: ReturnType<typeof vi.fn>;
  };
  let mockStreamManager: {
    subscribeToRun: ReturnType<typeof vi.fn>;
    unsubscribeFromRun: ReturnType<typeof vi.fn>;
    unsubscribeAllFromConnection: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let mockRunEvents: {
    subscribe: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    emitStarted: ReturnType<typeof vi.fn>;
    emitDelta: ReturnType<typeof vi.fn>;
    emitCompleted: ReturnType<typeof vi.fn>;
    emitFailed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessionService = {
      createSession: vi.fn(),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      submitMessageStreaming: vi.fn(),
    };

    mockStreamManager = {
      subscribeToRun: vi.fn(),
      unsubscribeFromRun: vi.fn(),
      unsubscribeAllFromConnection: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockRunEvents = {
      subscribe: vi.fn().mockReturnValue(() => {}),
      emit: vi.fn(),
      emitStarted: vi.fn(),
      emitDelta: vi.fn(),
      emitCompleted: vi.fn(),
      emitFailed: vi.fn(),
    };

    // Create handler with streaming support
    handler = new SessionHandler(
      mockSessionService as unknown as SessionMessageService,
      mockLogger,
      mockStreamManager as unknown as NonNullable<
        Parameters<typeof createSessionHandler>[2]
      >,
      mockRunEvents as unknown as NonNullable<
        Parameters<typeof createSessionHandler>[3]
      >,
    );
  });

  describe('handleMessage with streaming', () => {
    it('should return session.message.ack for streaming requests when streaming is configured', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'session-123',
        status: 'active',
        runId: null,
        reasoningContent: null,
        firstMessageId: null,
        metadata: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        title: 'Mock Session',
        type: 'chat',
        archivedAt: null,
      });

      mockSessionService.submitMessageStreaming.mockResolvedValue({
        ok: true,
        userMessage: { id: 'msg-1', content: 'Hello', role: 'user' },
        assistantMessage: {
          id: 'msg-2',
          content: 'Hi there!',
          role: 'assistant',
        },
        run: {
          id: 'run-1',
          finishReason: 'stop',
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      });

      const request = createWSMessage('session.message', {
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
        stream: true,
      }) as SessionMessageRequest;

      const response = await handler.handleMessage(
        'conn-1',
        request,
        mockContext,
      );

      // Should return ack response
      expect(response.type).toBe('session.message.ack');
      expect(
        (
          response as unknown as {
            payload: { sessionId: string; runId: string; status: string };
          }
        ).payload.sessionId,
      ).toBe('session-123');
      expect(
        (
          response as unknown as {
            payload: { sessionId: string; runId: string; status: string };
          }
        ).payload.runId,
      ).toBeDefined();
      expect(
        (
          response as unknown as {
            payload: { sessionId: string; runId: string; status: string };
          }
        ).payload.status,
      ).toBe('streaming');

      // Should have subscribed to the run
      expect(mockStreamManager.subscribeToRun).toHaveBeenCalled();
    });

    it('should subscribe to run events before starting streaming', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'session-123',
        status: 'active',
        runId: null,
        reasoningContent: null,
        firstMessageId: null,
        metadata: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        title: 'Mock Session',
        type: 'chat',
        archivedAt: null,
      });

      const request = createWSMessage('session.message', {
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
        stream: true,
      }) as SessionMessageRequest;

      await handler.handleMessage('conn-1', request, mockContext);

      // Verify subscription happened
      expect(mockStreamManager.subscribeToRun).toHaveBeenCalledWith(
        expect.any(String), // runId
        'conn-1',
      );
    });

    it('should return NOT_FOUND for streaming request with non-existent session', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = createWSMessage('session.message', {
        sessionId: 'nonexistent',
        role: 'user',
        content: 'Hello',
        stream: true,
      }) as SessionMessageRequest;

      const response = await handler.handleMessage(
        'conn-1',
        request,
        mockContext,
      );

      expect(response.type).toBe('error');
      expect(
        (response as { payload: { error: { code: string } } }).payload.error
          .code,
      ).toBe(WS_ERROR_CODES.NOT_FOUND);
    });

    it.skip('should emit run events during streaming', async () => {
      // TODO: Fix mock event emitter issues - streaming run events not being captured
      mockSessionService.getSession.mockResolvedValue({
        id: 'session-123',
        status: 'active',
        runId: null,
        reasoningContent: null,
        firstMessageId: null,
        metadata: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        title: 'Mock Session',
        type: 'chat',
        archivedAt: null,
      });

      mockSessionService.submitMessageStreaming.mockResolvedValue({
        ok: true,
        userMessage: { id: 'msg-1', content: 'Hello', role: 'user' },
        assistantMessage: {
          id: 'msg-2',
          content: 'Hi there!',
          role: 'assistant',
        },
        run: {
          id: 'run-1',
          finishReason: 'stop',
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      });

      const request = createWSMessage('session.message', {
        sessionId: 'session-123',
        role: 'user',
        content: 'Hello',
        stream: true,
      }) as SessionMessageRequest;

      await handler.handleMessage('conn-1', request, mockContext);

      // Wait for background execution to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify run events were emitted
      expect(mockRunEvents.emitStarted).toHaveBeenCalled();
      expect(mockRunEvents.emitDelta).toHaveBeenCalled();
      expect(mockRunEvents.emitCompleted).toHaveBeenCalled();
    });
  });
});
