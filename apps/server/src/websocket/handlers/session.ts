/**
 * Session Handler
 *
 * WebSocket message handlers for session operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service';
import type { StreamManager } from '../streaming';
import type { RunEventEmitter } from '../../dispatch/events';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type WSErrorCode,
  type ErrorResponse,
  type SessionCreateRequest,
  type SessionGetRequest,
  type SessionListRequest,
  type SessionDeleteRequest,
  type SessionMessageRequest,
  type SessionCreatedResponse,
  type SessionMessageResponse,
  type SessionMessageStreamAck,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import type { Session, SessionMessage, SessionRun } from '@openaidy/db';

// ============================================================================
// Types
// ============================================================================

/**
 * Session list response type
 */
export type SessionListResponse = WSMessage<
  'session.list',
  {
    sessions: Array<{
      id: string;
      title?: string;
      status: string;
      createdAt: string;
      updatedAt?: string;
    }>;
    total: number;
  }
>;

/**
 * Session get response type
 */
export type SessionGetResponse = WSMessage<
  'session.get',
  {
    session: {
      id: string;
      title?: string;
      status: string;
      createdAt: string;
      updatedAt?: string;
    };
  }
>;

/**
 * Session delete response type
 */
export type SessionDeleteResponse = WSMessage<
  'session.delete',
  {
    sessionId: string;
    deleted: boolean;
  }
>;

// ============================================================================
// Session Handler Class
// ============================================================================

/**
 * Handles session-related WebSocket messages
 */
export class SessionHandler {
  constructor(
    private sessionService: SessionMessageService,
    private logger: FastifyBaseLogger,
    private streamManager?: StreamManager,
    private runEvents?: RunEventEmitter,
  ) {}

  /**
   * Handle session.create request
   */
  async handleCreate(
    connectionId: string,
    request: SessionCreateRequest,
    _context: HandlerContext,
  ): Promise<SessionCreatedResponse | ErrorResponse> {
    try {
      // Create session via service
      const session = await this.sessionService.createSession(
        `Session ${new Date().toISOString()}`,
      );

      const sessionRecord = session as Session;

      this.logger.info(
        { sessionId: sessionRecord.id, connectionId },
        'Session created via WebSocket',
      );

      return createWSMessage(
        'session.created',
        {
          sessionId: sessionRecord.id,
          agentId: request.payload.agentId ?? 'default',
          createdAt: sessionRecord.createdAt ?? new Date().toISOString(),
        },
        request.id,
      ) as SessionCreatedResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to create session');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to create session',
      );
    }
  }

  /**
   * Handle session.get request
   */
  async handleGet(
    connectionId: string,
    request: SessionGetRequest,
    _context: HandlerContext,
  ): Promise<SessionGetResponse | ErrorResponse> {
    try {
      const session = await this.sessionService.getSession(
        request.payload.sessionId,
      );

      if (!session) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Session ${request.payload.sessionId} not found`,
        );
      }

      const sessionRecord = session as Session;

      return createWSMessage(
        'session.get',
        {
          session: {
            id: sessionRecord.id,
            title: sessionRecord.title,
            status: sessionRecord.status ?? 'active',
            createdAt: sessionRecord.createdAt ?? new Date().toISOString(),
            updatedAt: sessionRecord.updatedAt,
          },
        },
        request.id,
      ) as SessionGetResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get session');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get session',
      );
    }
  }

  /**
   * Handle session.list request
   */
  async handleList(
    connectionId: string,
    request: SessionListRequest,
    _context: HandlerContext,
  ): Promise<SessionListResponse | ErrorResponse> {
    try {
      const sessions = await this.sessionService.listSessions();

      // Apply filters
      let filtered = sessions;
      if (request.payload.status && request.payload.status !== 'all') {
        filtered = sessions.filter(
          (s) => (s as Session).status === request.payload.status,
        );
      }
      if (request.payload.agentId) {
        // Filter by agentId if stored in metadata
        filtered = filtered.filter((s) => {
          const metadata = (s as Session).metadata as
            | Record<string, unknown>
            | undefined;
          return metadata?.agentId === request.payload.agentId;
        });
      }

      // Apply pagination
      const offset = request.payload.offset ?? 0;
      const limit = request.payload.limit ?? 50;
      const paginated = filtered.slice(offset, offset + limit);

      return createWSMessage(
        'session.list',
        {
          sessions: paginated.map((s) => {
            const session = s as Session;
            return {
              id: session.id,
              title: session.title,
              status: session.status ?? 'active',
              createdAt: session.createdAt ?? new Date().toISOString(),
              updatedAt: session.updatedAt,
            };
          }),
          total: filtered.length,
        },
        request.id,
      ) as SessionListResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to list sessions');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to list sessions',
      );
    }
  }

  /**
   * Handle session.delete request
   */
  async handleDelete(
    connectionId: string,
    request: SessionDeleteRequest,
    _context: HandlerContext,
  ): Promise<SessionDeleteResponse | ErrorResponse> {
    try {
      // Attempt to delete the session
      const deleted = await this.sessionService.deleteSession(
        request.payload.sessionId,
      );

      if (!deleted) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Session ${request.payload.sessionId} not found`,
        );
      }

      this.logger.info(
        { sessionId: request.payload.sessionId, connectionId },
        'Session deleted via WebSocket',
      );

      return createWSMessage(
        'session.delete',
        {
          sessionId: request.payload.sessionId,
          deleted: true,
        },
        request.id,
      ) as SessionDeleteResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to delete session');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to delete session',
      );
    }
  }

  /**
   * Handle session.message request
   *
   * Supports both streaming and non-streaming modes:
   * - Non-streaming (stream: false or omitted): Returns full response
   * - Streaming (stream: true): Returns ack with runId, streams events
   */
  async handleMessage(
    connectionId: string,
    request: SessionMessageRequest,
    _context: HandlerContext,
  ): Promise<SessionMessageResponse | SessionMessageStreamAck | ErrorResponse> {
    try {
      // Check if streaming is requested
      if (request.payload.stream) {
        return this.handleStreamingMessage(connectionId, request, _context);
      }

      // Submit message via service
      const result = await this.sessionService.submitMessage({
        sessionId: request.payload.sessionId,
        role: request.payload.role,
        content: request.payload.content,
        agentId: request.payload.metadata?.agentId as string | undefined,
        providerId: request.payload.metadata?.providerId as string | undefined,
        modelId: request.payload.metadata?.modelId as string | undefined,
      });

      if (!result.ok) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INTERNAL_ERROR,
          result.error.message,
          { code: result.error.code },
        );
      }

      const assistantMessage = result.assistantMessage as SessionMessage;
      const _userMessage = result.userMessage as SessionMessage;
      const run = result.run as SessionRun;

      this.logger.info(
        {
          sessionId: request.payload.sessionId,
          messageId: assistantMessage.id,
          connectionId,
        },
        'Message submitted via WebSocket',
      );

      return createWSMessage(
        'session.message',
        {
          sessionId: request.payload.sessionId,
          messageId: assistantMessage.id,
          role: 'assistant',
          content: assistantMessage.content,
          usage: run.usage
            ? {
                promptTokens: run.usage.promptTokens,
                completionTokens: run.usage.completionTokens,
                totalTokens: run.usage.totalTokens,
              }
            : undefined,
          finishReason: run.finishReason,
        },
        request.id,
      ) as SessionMessageResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to submit message');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to submit message',
      );
    }
  }

  /**
   * Handle streaming session.message request
   *
   * When stream: true:
   * 1. Validates session exists
   * 2. Creates run and subscribes connection to run events
   * 3. Emits run events during streaming invocation
   * 4. Returns immediate ack with runId
   * 5. Stream events are delivered via session.stream.* events
   */
  private async handleStreamingMessage(
    connectionId: string,
    request: SessionMessageRequest,
    _context: HandlerContext,
  ): Promise<SessionMessageStreamAck | ErrorResponse> {
    // Check if streaming infrastructure is available
    if (!this.streamManager || !this.runEvents) {
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.SERVICE_UNAVAILABLE,
        'Streaming is not available on this server',
      );
    }

    try {
      // Validate session exists
      const session = await this.sessionService.getSession(
        request.payload.sessionId,
      );
      if (!session) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Session ${request.payload.sessionId} not found`,
        );
      }

      // Generate a run ID for tracking
      const runId = crypto.randomUUID();
      const agentId =
        (request.payload.metadata?.agentId as string) ?? 'default';

      // Subscribe the connection to run events BEFORE starting
      this.streamManager.subscribeToRun(runId, connectionId);

      this.logger.info(
        { sessionId: request.payload.sessionId, runId, connectionId },
        'Starting streaming message',
      );

      // Start the streaming invocation in the background
      // We don't await this - it will emit events as it progresses
      this.executeStreamingRun(runId, request, agentId, _context).catch(
        (error) => {
          this.logger.error(
            { error, runId, sessionId: request.payload.sessionId },
            'Streaming run failed',
          );
          // Emit failure event if not already emitted
          this.runEvents?.emitFailed({
            runId,
            sessionId: request.payload.sessionId,
            agentId,
            errorCode: 'internal_error',
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
          });
        },
      );

      // Return immediate ack with runId
      return createWSMessage(
        'session.message.ack',
        {
          sessionId: request.payload.sessionId,
          runId,
          status: 'streaming',
        },
        request.id,
      ) as SessionMessageStreamAck;
    } catch (error) {
      this.logger.error(
        { error, connectionId },
        'Failed to start streaming message',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to start streaming message',
      );
    }
  }

  /**
   * Execute a streaming run, emitting events as it progresses
   *
   * This is called in the background after returning the ack response.
   */
  private async executeStreamingRun(
    runId: string,
    request: SessionMessageRequest,
    agentId: string,
    _context: HandlerContext,
  ): Promise<void> {
    const sessionId = request.payload.sessionId;
    const providerId = request.payload.metadata?.providerId as
      | string
      | undefined;
    const modelId = request.payload.metadata?.modelId as string | undefined;

    try {
      // Emit run.started event
      const resolvedProviderId = providerId ?? 'default';
      const resolvedModelId = modelId ?? 'default';

      this.runEvents?.emitStarted({
        runId,
        sessionId,
        agentId,
        providerId: resolvedProviderId,
        modelId: resolvedModelId,
      });

      // Submit the message (non-streaming for now, but we emit delta events)
      // In a full implementation, this would use streaming invocation
      const result = await this.sessionService.submitMessage({
        sessionId,
        role: request.payload.role,
        content: request.payload.content,
        agentId,
        providerId,
        modelId,
      });

      if (result.ok) {
        const run = result.run as SessionRun;

        // Emit delta with the full content (simulated streaming)
        const assistantMessage = result.assistantMessage as SessionMessage;
        this.runEvents?.emitDelta({
          runId,
          sessionId,
          agentId,
          content: assistantMessage.content,
          delta: assistantMessage.content,
        });

        // Emit completion
        this.runEvents?.emitCompleted({
          runId,
          sessionId,
          agentId,
          finishReason: run.finishReason ?? 'stop',
          usage: run.usage
            ? {
                promptTokens: run.usage.promptTokens,
                completionTokens: run.usage.completionTokens,
                totalTokens: run.usage.totalTokens,
              }
            : undefined,
        });

        this.logger.info(
          { sessionId, runId, messageId: assistantMessage.id },
          'Streaming run completed',
        );
      } else {
        // Emit failure
        this.runEvents?.emitFailed({
          runId,
          sessionId,
          agentId,
          errorCode: result.error.code,
          errorMessage: result.error.message,
        });

        this.logger.warn(
          { sessionId, runId, error: result.error },
          'Streaming run failed',
        );
      }
    } catch (error) {
      // Emit failure
      this.runEvents?.emitFailed({
        runId,
        sessionId,
        agentId,
        errorCode: 'internal_error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Create an error response
   */
  private createErrorResponse(
    requestId: string,
    code: WSErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): ErrorResponse {
    const error: WSError = {
      code,
      message,
      ...(details !== undefined && { details }),
    };

    return createWSMessage('error', {
      requestId,
      error,
    }) as ErrorResponse;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create session handler instance
 */
export function createSessionHandler(
  sessionService: SessionMessageService,
  logger: FastifyBaseLogger,
  streamManager?: StreamManager,
  runEvents?: RunEventEmitter,
): SessionHandler {
  return new SessionHandler(sessionService, logger, streamManager, runEvents);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register session handlers with message router
 */
export function registerSessionHandlers(
  router: {
    registerHandler: (
      type: string,
      handler: (
        connId: string,
        msg: WSMessage,
        ctx: HandlerContext,
      ) => Promise<WSResponse | void>,
    ) => void;
  },
  handler: SessionHandler,
): void {
  router.registerHandler('session.create', (connId, msg, ctx) =>
    handler.handleCreate(connId, msg as SessionCreateRequest, ctx),
  );

  router.registerHandler('session.get', (connId, msg, ctx) =>
    handler.handleGet(connId, msg as SessionGetRequest, ctx),
  );

  router.registerHandler('session.list', (connId, msg, ctx) =>
    handler.handleList(connId, msg as SessionListRequest, ctx),
  );

  router.registerHandler('session.delete', (connId, msg, ctx) =>
    handler.handleDelete(connId, msg as SessionDeleteRequest, ctx),
  );

  router.registerHandler('session.message', (connId, msg, ctx) =>
    handler.handleMessage(connId, msg as SessionMessageRequest, ctx),
  );
}

export default SessionHandler;
