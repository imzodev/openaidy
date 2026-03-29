/**
 * Provider Handler
 *
 * WebSocket message handlers for provider operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ProviderServices } from '../../providers';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  type ProviderListRequest,
  type ProviderModelsRequest,
  type ProviderListResponse,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Provider models response type
 */
export type ProviderModelsResponse = WSMessage<
  'provider.models',
  {
    providerId: string;
    models: Array<{
      id: string;
      name: string;
      capabilities?: string[];
    }>;
  }
>;

// ============================================================================
// Provider Handler Class
// ============================================================================

/**
 * Handles provider-related WebSocket messages
 */
export class ProviderHandler {
  constructor(
    private providerServices: ProviderServices,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Handle provider.list request
   */
  async handleList(
    connectionId: string,
    request: ProviderListRequest,
    context: HandlerContext,
  ): Promise<ProviderListResponse | ErrorResponse> {
    try {
      const descriptors = this.providerServices.registry.listDescriptors();

      this.logger.info(
        { count: descriptors.length, connectionId },
        'Listing providers via WebSocket',
      );

      return createWSMessage('provider.list', {
        providers: descriptors.map((desc) => ({
          id: desc.id,
          name: desc.name,
          vendorFamily: desc.vendorFamily,
          capabilities: desc.capabilities ?? [],
        })),
      }) as ProviderListResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to list providers');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to list providers',
      );
    }
  }

  /**
   * Handle provider.models request
   */
  async handleModels(
    connectionId: string,
    request: ProviderModelsRequest,
    context: HandlerContext,
  ): Promise<ProviderModelsResponse | ErrorResponse> {
    try {
      const { providerId } = request.payload;

      const provider = this.providerServices.registry.get(providerId);

      if (!provider) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `Provider ${providerId} not found`,
        );
      }

      const descriptor = provider.descriptor;

      this.logger.info(
        { providerId, connectionId, modelCount: descriptor.models?.length ?? 0 },
        'Getting provider models via WebSocket',
      );

      return createWSMessage('provider.models', {
        providerId,
        models: (descriptor.models ?? []).map((model) => ({
          id: model.id,
          name: model.name,
          capabilities: model.capabilities,
        })),
      }) as ProviderModelsResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get provider models');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get provider models',
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
 * Create provider handler instance
 */
export function createProviderHandler(
  providerServices: ProviderServices,
  logger: FastifyBaseLogger,
): ProviderHandler {
  return new ProviderHandler(providerServices, logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register provider handlers with message router
 */
export function registerProviderHandlers(
  router: {
    registerHandler: (type: string, handler: (connId: string, msg: WSMessage, ctx: HandlerContext) => Promise<WSResponse | void>) => void;
  },
  handler: ProviderHandler,
): void {
  router.registerHandler('provider.list', (connId, msg, ctx) =>
    handler.handleList(connId, msg as ProviderListRequest, ctx),
  );

  router.registerHandler('provider.models', (connId, msg, ctx) =>
    handler.handleModels(connId, msg as ProviderModelsRequest, ctx),
  );
}

export default ProviderHandler;
