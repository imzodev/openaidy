/**
 * Agent Handler
 *
 * WebSocket message handlers for agent operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { AgentRegistry } from '../../agents/registry';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  type AgentListRequest,
  type AgentGetRequest,
  type AgentListResponse,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import type { Agent } from '../../agents/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Agent get response type
 */
export type AgentGetResponse = WSMessage<
  'agent.get',
  {
    agent: {
      id: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      capabilities: string[];
      enabled: boolean;
    };
  }
>;

// ============================================================================
// Agent Handler Class
// ============================================================================

/**
 * Handles agent-related WebSocket messages
 */
export class AgentHandler {
  constructor(
    private agentRegistry: AgentRegistry,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Handle agent.list request
   */
  async handleList(
    connectionId: string,
    request: AgentListRequest,
    context: HandlerContext,
  ): Promise<AgentListResponse | ErrorResponse> {
    try {
      const agents = this.agentRegistry.listAgents();

      this.logger.info(
        { count: agents.length, connectionId },
        'Listing agents via WebSocket',
      );

      return createWSMessage('agent.list', {
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          capabilities: agent.capabilities ?? [],
        })),
      }) as AgentListResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to list agents');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to list agents',
      );
    }
  }

  /**
   * Handle agent.get request
   */
  async handleGet(
    connectionId: string,
    request: AgentGetRequest,
    context: HandlerContext,
  ): Promise<AgentGetResponse | ErrorResponse> {
    try {
      const agent = this.agentRegistry.getAgent(request.payload.agentId);

      if (!agent) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Agent ${request.payload.agentId} not found`,
        );
      }

      this.logger.info(
        { agentId: agent.id, connectionId },
        'Getting agent via WebSocket',
      );

      return createWSMessage('agent.get', {
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          capabilities: agent.capabilities ?? [],
          enabled: agent.enabled,
        },
      }) as AgentGetResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get agent');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get agent',
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
    code: string,
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
 * Create agent handler instance
 */
export function createAgentHandler(
  agentRegistry: AgentRegistry,
  logger: FastifyBaseLogger,
): AgentHandler {
  return new AgentHandler(agentRegistry, logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register agent handlers with message router
 */
export function registerAgentHandlers(
  router: {
    registerHandler: (type: string, handler: (connId: string, msg: WSMessage, ctx: HandlerContext) => Promise<WSResponse | void>) => void;
  },
  handler: AgentHandler,
): void {
  router.registerHandler('agent.list', (connId, msg, ctx) =>
    handler.handleList(connId, msg as AgentListRequest, ctx),
  );

  router.registerHandler('agent.get', (connId, msg, ctx) =>
    handler.handleGet(connId, msg as AgentGetRequest, ctx),
  );
}

export default AgentHandler;
