/**
 * Session Handler
 *
 * WebSocket message handlers for session operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service';
import type { StreamManager } from '../streaming';
import type { SubscriptionManager } from '../subscriptions';
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
  type SessionMessagesRequest,
  type SessionRunsRequest,
  type SessionCreatedResponse,
  type SessionMessageResponse,
  type SessionMessagesResponse,
  type SessionRunsResponse,
  type SessionMessageStreamAck,
  type SessionGetResponse,
  type SessionListResponse,
  type SessionDeleteResponse,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import type { Session, SessionMessage, SessionRun } from '@openaidy/db';

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
    private subscriptionManager?: SubscriptionManager,
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
          createdAt: new Date(sessionRecord.createdAt).toISOString(),
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
      const agentId = (sessionRecord as { agentId?: string }).agentId;

      return createWSMessage(
        'session.get',
        {
          session: {
            id: sessionRecord.id,
            title: sessionRecord.title,
            status: sessionRecord.status ?? 'active',
            agentId,
            createdAt: new Date(sessionRecord.createdAt).toISOString(),
            updatedAt: sessionRecord.updatedAt
              ? new Date(sessionRecord.updatedAt).toISOString()
              : undefined,
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
      const sessions = (await this.sessionService.listSessions()) as Session[];

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
          const metadata = (s as Record<string, unknown>).metadata as
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
              agentId: (session as { agentId?: string }).agentId,
              createdAt: new Date(session.createdAt).toISOString(),
              updatedAt: session.updatedAt
                ? new Date(session.updatedAt).toISOString()
                : undefined,
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
   * Handle session.messages request
   */
  async handleMessages(
    connectionId: string,
    request: SessionMessagesRequest,
    _context: HandlerContext,
  ): Promise<SessionMessagesResponse | ErrorResponse> {
    try {
      const messages = (await this.sessionService.listMessages(
        request.payload.sessionId,
      )) as SessionMessage[];

      // Apply pagination
      const offset = request.payload.offset ?? 0;
      const limit = request.payload.limit ?? 50;
      const paginated = messages.slice(offset, offset + limit);

      this.logger.info(
        {
          sessionId: request.payload.sessionId,
          count: paginated.length,
          total: messages.length,
          connectionId,
        },
        'Listing messages via WebSocket',
      );

      return createWSMessage(
        'session.messages',
        {
          sessionId: request.payload.sessionId,
          messages: paginated.map((msg) => {
            const reasoningContent = (msg as { reasoningContent?: string })
              .reasoningContent;
            return {
              id: msg.id,
              sessionId: msg.sessionId,
              role: msg.role,
              content: msg.content,
              sequence: msg.sequence,
              createdAt: new Date(msg.createdAt).toISOString(),
              metadata: msg.metadata as Record<string, unknown> | undefined,
              ...(reasoningContent ? { reasoningContent } : {}),
            };
          }),
          total: messages.length,
        },
        request.id,
      ) as SessionMessagesResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to list messages');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to list messages',
      );
    }
  }

  /**
   * Handle session.runs request
   */
  async handleRuns(
    connectionId: string,
    request: SessionRunsRequest,
    _context: HandlerContext,
  ): Promise<SessionRunsResponse | ErrorResponse> {
    try {
      const runs = (await this.sessionService.listRuns(
        request.payload.sessionId,
      )) as SessionRun[];

      // Apply pagination
      const offset = request.payload.offset ?? 0;
      const limit = request.payload.limit ?? 50;
      const paginated = runs.slice(offset, offset + limit);

      this.logger.info(
        {
          sessionId: request.payload.sessionId,
          count: paginated.length,
          total: runs.length,
          connectionId,
        },
        'Listing runs via WebSocket',
      );

      return createWSMessage(
        'session.runs',
        {
          sessionId: request.payload.sessionId,
          runs: paginated.map((run) => ({
            id: run.id,
            sessionId: run.sessionId,
            agentId: run.agentId ?? undefined,
            providerId: run.providerId,
            modelId: run.modelId,
            status: run.status,
            finishReason: run.finishReason ?? undefined,
            errorCode: run.errorCode ?? undefined,
            errorMessage: run.errorMessage ?? undefined,
            createdAt: new Date(run.createdAt).toISOString(),
          })),
          total: runs.length,
        },
        request.id,
      ) as SessionRunsResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to list runs');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to list runs',
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
      const resolvedAgentId =
        request.payload.agentId ??
        (request.payload.metadata?.agentId as string | undefined);
      const resolvedProviderId =
        request.payload.providerId ??
        (request.payload.metadata?.providerId as string | undefined);
      const resolvedModelId =
        request.payload.modelId ??
        (request.payload.metadata?.modelId as string | undefined);
      const result = await this.sessionService.submitMessageStreaming({
        sessionId: request.payload.sessionId,
        role: request.payload.role,
        content: request.payload.content,
        ...(resolvedAgentId != null && { agentId: resolvedAgentId }),
        ...(resolvedProviderId != null && { providerId: resolvedProviderId }),
        ...(resolvedModelId != null && { modelId: resolvedModelId }),
        onStreamEvent: () => {},
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
          usage:
            run.promptTokens != null
              ? {
                  promptTokens: run.promptTokens,
                  completionTokens: run.completionTokens ?? 0,
                  totalTokens: run.totalTokens ?? 0,
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
        request.payload.agentId ??
        (request.payload.metadata?.agentId as string | undefined) ??
        'default';

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
   * Uses true streaming invocation to emit deltas in real-time.
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

      // Submit the message with streaming - emits events as they arrive
      const result = await this.sessionService.submitMessageStreaming({
        sessionId,
        role: request.payload.role,
        content: request.payload.content,
        agentId,
        ...(providerId != null && { providerId }),
        ...(modelId != null && { modelId }),
        onStreamEvent: (event) => {
          switch (event.type) {
            case 'delta':
              this.runEvents?.emitDelta({
                runId,
                sessionId,
                agentId,
                content: event.content ?? '',
                delta: event.content ?? '',
              });
              break;
            case 'tool_call':
              this.runEvents?.emitToolCall({
                runId,
                sessionId,
                agentId,
                toolCall: event.toolCall!,
              });
              break;
            case 'usage':
              // Usage will be included in completion
              break;
            case 'error':
              this.runEvents?.emitFailed({
                runId,
                sessionId,
                agentId,
                errorCode: event.error?.code ?? 'streaming_error',
                errorMessage: event.error?.message ?? 'Streaming error',
              });
              break;
            case 'choices':
              this.runEvents?.emitChoices({
                runId,
                sessionId,
                agentId,
                ...(event.question !== undefined && {
                  question: event.question,
                }),
                choices: event.choices,
              });
              break;
          }
        },
      });

      if (result.ok) {
        const run = result.run as SessionRun;

        // If run was suspended (choices emitted), do NOT emit completion —
        // the choices event was already emitted, and we're awaiting user input.
        const suspended = (run as { metadata?: { suspended?: boolean } })
          .metadata?.suspended;
        if (suspended) {
          this.logger.info(
            { sessionId, runId },
            'Streaming run suspended (choices presented)',
          );
          return;
        }

        const assistantMessage = result.assistantMessage as SessionMessage;

        // Emit completion with final usage
        this.runEvents?.emitCompleted({
          runId,
          sessionId,
          agentId,
          finishReason: run.finishReason ?? 'stop',
          ...(run.promptTokens != null && {
            usage: {
              promptTokens: run.promptTokens,
              completionTokens: run.completionTokens ?? 0,
              totalTokens: run.totalTokens ?? 0,
            },
          }),
        });

        this.logger.info(
          { sessionId, runId, messageId: assistantMessage.id },
          'Streaming run completed',
        );

        // Auto-rename session on the first run
        this.maybeRenameSession(
          sessionId,
          request.payload.content,
          run.providerId,
          run.modelId,
        ).catch((err: unknown) => {
          this.logger.warn(
            { err, sessionId },
            'Auto-rename session failed (non-fatal)',
          );
        });
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
   * Auto-rename the session after the first run completes.
   *
   * Checks that this is the first run (only 1 run for the session) before
   * generating a title. Broadcasts `session.updated` to all subscribers.
   */
  private async maybeRenameSession(
    sessionId: string,
    userMessage: string,
    providerId: string,
    modelId: string,
  ): Promise<void> {
    const runs = await this.sessionService.listRuns(sessionId);
    if (runs.length !== 1) return;

    const title = await this.sessionService.generateTitle(
      userMessage,
      providerId,
      modelId,
    );
    if (!title) return;

    await this.sessionService.updateSessionTitle(sessionId, title);

    this.logger.info({ sessionId, title }, 'Session auto-renamed');

    if (this.subscriptionManager) {
      const event = createWSMessage('session.updated', {
        sessionId,
        updates: { title },
        updatedAt: new Date().toISOString(),
      });
      this.subscriptionManager.broadcastToSession(sessionId, event);
    }
  }

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
  subscriptionManager?: SubscriptionManager,
): SessionHandler {
  return new SessionHandler(
    sessionService,
    logger,
    streamManager,
    runEvents,
    subscriptionManager,
  );
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
  router.registerHandler(
    'session.create',
    (connId, msg, ctx) =>
      handler.handleCreate(
        connId,
        msg as SessionCreateRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'session.get',
    (connId, msg, ctx) =>
      handler.handleGet(
        connId,
        msg as SessionGetRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'session.list',
    (connId, msg, ctx) =>
      handler.handleList(
        connId,
        msg as SessionListRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'session.delete',
    (connId, msg, ctx) =>
      handler.handleDelete(
        connId,
        msg as SessionDeleteRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'session.message',
    (connId, msg, ctx) =>
      handler.handleMessage(
        connId,
        msg as SessionMessageRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'session.messages',
    (connId, msg, ctx) =>
      handler.handleMessages(
        connId,
        msg as SessionMessagesRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'session.runs',
    (connId, msg, ctx) =>
      handler.handleRuns(
        connId,
        msg as SessionRunsRequest,
        ctx,
      ) as Promise<WSResponse>,
  );
}

export default SessionHandler;
