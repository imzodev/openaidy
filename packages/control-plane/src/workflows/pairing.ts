/**
 * Control Plane - Pairing Workflow
 * 
 * Provides workflow-oriented interface for device pairing operations.
 * This layer normalizes results and errors for CLI consumption while
 * remaining independent from terminal formatting.
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  type WorkflowResult,
  type WorkflowError,
  type WorkflowErrorCode,
  type PairingRequestStatus,
  type PairingRequestData,
  type ListPairingRequestsResult,
  type PairingRequestActionResult,
  success,
  failure,
} from '../types.js';

// Re-export types for consumers
export type {
  WorkflowResult,
  WorkflowError,
  PairingRequestStatus,
  PairingRequestData,
  ListPairingRequestsResult,
  PairingRequestActionResult,
};

// ============================================================================
// Workflow Options
// ============================================================================

/**
 * Options for pairing workflow list operations.
 */
export type ListRequestsOptions = {
  /** Filter by status */
  status?: PairingRequestStatus;
};

/**
 * Options for pairing workflow operations.
 */
export type PairingWorkflowOptions = {
  /** Filter by status */
  status?: PairingRequestStatus;
  /** Logger instance */
  logger?: FastifyBaseLogger;
};

// ============================================================================
// Workflow Context
// ============================================================================

/**
 * Context passed to pairing workflows.
 * Provides access to the pairing service.
 */
export type PairingContext = {
  /** Pairing service instance */
  pairingService: {
    getPendingRequests(): PairingRequestData[];
    getAllRequests(): PairingRequestData[];
    getRequest(requestId: string): PairingRequestData | undefined;
    approveRequest(requestId: string, approvedBy: string, scopes?: string[]): Promise<PairingRequestData | null>;
    denyRequest(requestId: string, deniedBy: string): PairingRequestData | null;
  };
  /** Actor performing the action (for audit) */
  actor: string;
  /** Logger instance */
  logger?: FastifyBaseLogger;
};

// ============================================================================
// Pairing Workflow Service
// ============================================================================

/**
 * Pairing Workflow Service
 * 
 * Provides workflow-oriented methods for device pairing operations.
 * This service wraps the pairing service and normalizes results.
 */
export class PairingWorkflow {
  private context: PairingContext;

  constructor(context: PairingContext) {
    this.context = context;
  }

  /**
   * List pairing requests, optionally filtered by status.
   */
  listRequests(options?: ListRequestsOptions): ListPairingRequestsResult {
    const { pairingService, logger } = this.context;
    const status = options?.status;

    let requests: PairingRequestData[];
    
    if (status === 'pending') {
      requests = pairingService.getPendingRequests();
    } else {
      requests = pairingService.getAllRequests();
    }

    // Filter by status if specified
    if (status && status !== 'pending') {
      requests = requests.filter(r => r.status === status);
    }

    logger?.debug({ count: requests.length, status }, 'Listed pairing requests');

    return success({
      requests,
      count: requests.length,
    });
  }

  /**
   * Get a single pairing request by ID.
   */
  getRequest(requestId: string): WorkflowResult<PairingRequestData> {
    const { pairingService, logger } = this.context;

    const request = pairingService.getRequest(requestId);

    if (!request) {
      logger?.warn({ requestId }, 'Pairing request not found');
      return failure(
        'PAIRING_REQUEST_NOT_FOUND',
        `Pairing request not found: ${requestId}`,
        { requestId },
      );
    }

    return success(request);
  }

  /**
   * Approve a pairing request.
   */
  async approveRequest(
    requestId: string,
    scopes?: string[],
  ): Promise<PairingRequestActionResult> {
    const { pairingService, actor, logger } = this.context;

    logger?.info({ requestId, actor, scopes }, 'Approving pairing request');

    const request = await pairingService.approveRequest(requestId, actor, scopes);

    if (!request) {
      // Check if request exists
      const existingRequest = pairingService.getRequest(requestId);
      
      if (!existingRequest) {
        return failure(
          'PAIRING_REQUEST_NOT_FOUND',
          `Pairing request not found: ${requestId}`,
          { requestId },
        );
      }

      if (existingRequest.status === 'expired') {
        return failure(
          'PAIRING_REQUEST_EXPIRED',
          `Pairing request has expired: ${requestId}`,
          { requestId, expiredAt: existingRequest.expiresAt },
        );
      }

      if (existingRequest.status !== 'pending') {
        return failure(
          'PAIRING_REQUEST_ALREADY_PROCESSED',
          `Pairing request already ${existingRequest.status}: ${requestId}`,
          { requestId, status: existingRequest.status },
        );
      }

      return failure(
        'INTERNAL_ERROR',
        `Failed to approve pairing request: ${requestId}`,
        { requestId },
      );
    }

    return success(request);
  }

  /**
   * Deny a pairing request.
   */
  denyRequest(requestId: string): PairingRequestActionResult {
    const { pairingService, actor, logger } = this.context;

    logger?.info({ requestId, actor }, 'Denying pairing request');

    const request = pairingService.denyRequest(requestId, actor);

    if (!request) {
      // Check if request exists
      const existingRequest = pairingService.getRequest(requestId);
      
      if (!existingRequest) {
        return failure(
          'PAIRING_REQUEST_NOT_FOUND',
          `Pairing request not found: ${requestId}`,
          { requestId },
        );
      }

      if (existingRequest.status !== 'pending') {
        return failure(
          'PAIRING_REQUEST_ALREADY_PROCESSED',
          `Pairing request already ${existingRequest.status}: ${requestId}`,
          { requestId, status: existingRequest.status },
        );
      }

      return failure(
        'INTERNAL_ERROR',
        `Failed to deny pairing request: ${requestId}`,
        { requestId },
      );
    }

    return success(request);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a pairing workflow service.
 */
export function createPairingWorkflow(context: PairingContext): PairingWorkflow {
  return new PairingWorkflow(context);
}
