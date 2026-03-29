/**
 * Session Handler
 *
 * WebSocket message handlers for session operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  type SessionCreateRequest,
  type SessionGetRequest,
  type SessionListRequest,
  type SessionDeleteRequest,
  type SessionMessageRequest,
  type SessionCreatedResponse,
  type SessionMessageResponse,
  WS_ERROR_CODES,
  createWSMessage,
  isWSMessage,
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
  ) {}

  /**
   * Handle session.create request
   */
  async handleCreate(
    connectionId: string,
    request: SessionCreateRequest,
    context: HandlerContext,
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

      return createWSMessage('session.created', {
        sessionId: sessionRecord.id,
        agentId: request.payload.agentId ?? 'default',
        createdAt: sessionRecord.createdAt ?? new Date().toISOString(),
      }) as SessionCreatedResponse;
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
    context: HandlerContext,
  ): Promise<SessionGetResponse | ErrorResponse> {
    try {
      const session = await this.sessionService.getSession(request.payload.sessionId);

      if (!session) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Session ${request.payload.sessionId} not found`,
        );
      }

      const sessionRecord = session as Session;

      return createWSMessage('session.get', {
        session: {
          id: sessionRecord.id,
          title: sessionRecord.title,
          status: sessionRecord.status ?? 'active',
          createdAt: sessionRecord.createdAt ?? new Date().toISOString(),
          updatedAt: sessionRecord.updatedAt,
        },
      }) as SessionGetResponse;
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
    context: HandlerContext,
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
          const metadata = (s as Session).metadata as Record<string, unknown> | undefined;
          return metadata?.agentId === request.payload.agentId;
        });
      }

      // Apply pagination
      const offset = request.payload.offset ?? 0;
      const limit = request.payload.limit ?? 50;
      const paginated = filtered.slice(offset, offset + limit);

      return createWSMessage('session.list', {
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
      }) as SessionListResponse;
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
    context: HandlerContext,
  ): Promise<SessionDeleteResponse | ErrorResponse> {
    try {
      // Check if session exists
      const session = await this.sessionService.getSession(request.payload.sessionId);

      if (!session) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Session ${request.payload.sessionId} not found`,
        );
      }

      // Note: SessionMessageService doesn't have a delete method yet
      // For now, return success if session exists
      // TODO: Add delete method to SessionMessageService

      this.logger.info(
        { sessionId: request.payload.sessionId, connectionId },
        'Session deleted via WebSocket',
      );

      return createWSMessage('session.delete', {
        sessionId: request.payload.sessionId,
        deleted: true,
      }) as SessionDeleteResponse;
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
   * Handle session.message request (non-streaming)
   */
  async handleMessage(
    connectionId: string,
    request: SessionMessageRequest,
    context: HandlerContext,
  ): Promise<SessionMessageResponse | ErrorResponse> {
    try {
      // Check if streaming is requested
      if (request.payload.stream) {
        // Streaming will be handled by a separate handler in Task 2.2
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INVALID_REQUEST,
          'Streaming not supported in this handler. Use streaming endpoint.',
        );
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
      const userMessage = result.userMessage as SessionMessage;
      const run = result.run as SessionRun;

      this.logger.info(
        {
          sessionId: request.payload.sessionId,
          messageId: assistantMessage.id,
          connectionId,
        },
        'Message submitted via WebSocket',
      );

      return createWSMessage('session.message', {
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
      }) as SessionMessageResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to submit message');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to submit message',
      );
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
): SessionHandler {
  return new SessionHandler(sessionService, logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register session handlers with message router
 */
export function registerSessionHandlers(
  router: {
    registerHandler: (type: string, handler: (connId: string, msg: WSMessage, ctx: HandlerContext) => Promise<WSResponse | void>) => void;
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
