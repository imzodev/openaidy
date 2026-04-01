/**
 * Node Invocation Manager
 *
 * Tracks pending node invocations and correlates responses back to callers.
 * Handles timeout cleanup and disconnect scenarios.
 *
 * Issue #127: WebSocket: complete session streaming and real session mutation behavior
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ConnectionManager } from './connection-manager';
import {
  type WSResponse,
  type ErrorResponse,
  type NodeRpcRequest,
  type NodeRpcResponse,
  type NodeRpcError,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Pending invocation record
 */
type PendingInvocation = {
  invocationId: string;
  nodeId: string;
  targetConnectionId: string;
  callerConnectionId: string;
  callerRequestId: string;
  capability: string;
  params: Record<string, unknown>;
  createdAt: number;
  timeout: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  resolve: (response: WSResponse) => void;
  reject: (error: Error) => void;
};

/**
 * Options for creating an InvocationManager
 */
export type InvocationManagerOptions = {
  /** Default timeout for invocations in milliseconds */
  defaultTimeout?: number;
  /** Maximum timeout allowed in milliseconds */
  maxTimeout?: number;
};

/**
 * Result of starting an invocation
 */
export type InvocationStartResult =
  | { ok: true; invocationId: string; promise: Promise<WSResponse> }
  | { ok: false; error: { code: string; message: string } };

// ============================================================================
// Invocation Manager
// ============================================================================

/**
 * Manages pending node invocations
 *
 * Responsibilities:
 * - Generate unique invocation IDs
 * - Track pending invocations with correlation
 * - Handle timeouts with cleanup
 * - Handle disconnects (both caller and target node)
 * - Route responses back to callers
 */
export class InvocationManager {
  private pending: Map<string, PendingInvocation> = new Map();
  // Index by caller connection for cleanup
  private byCaller: Map<string, Set<string>> = new Map();
  // Index by target node for cleanup
  private byNode: Map<string, Set<string>> = new Map();

  private defaultTimeout: number;
  private maxTimeout: number;

  constructor(
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
    options: InvocationManagerOptions = {},
  ) {
    this.defaultTimeout = options.defaultTimeout ?? 30000; // 30 seconds
    this.maxTimeout = options.maxTimeout ?? 300000; // 5 minutes
  }

  // ============================================================================
  // Invocation Lifecycle
  // ============================================================================

  /**
   * Start a new invocation
   *
   * Creates a pending invocation record and returns a promise that will be
   * resolved when the node responds or rejected on timeout/error.
   */
  startInvocation(
    nodeId: string,
    targetConnectionId: string,
    callerConnectionId: string,
    callerRequestId: string,
    capability: string,
    params: Record<string, unknown>,
    timeout?: number,
  ): InvocationStartResult {
    const invocationId = this.generateInvocationId();
    const effectiveTimeout = Math.min(
      timeout ?? this.defaultTimeout,
      this.maxTimeout,
    );

    // Create promise for response
    let resolvePromise: (response: WSResponse) => void;
    let rejectPromise: (error: Error) => void;

    const promise = new Promise<WSResponse>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Create pending record
    const pending: PendingInvocation = {
      invocationId,
      nodeId,
      targetConnectionId,
      callerConnectionId,
      callerRequestId,
      capability,
      params,
      createdAt: Date.now(),
      timeout: effectiveTimeout,
      resolve: resolvePromise!,
      reject: rejectPromise!,
    };

    // Set up timeout
    pending.timeoutHandle = setTimeout(() => {
      this.handleTimeout(invocationId);
    }, effectiveTimeout);

    // Store pending invocation
    this.pending.set(invocationId, pending);

    // Update caller index
    if (!this.byCaller.has(callerConnectionId)) {
      this.byCaller.set(callerConnectionId, new Set());
    }
    this.byCaller.get(callerConnectionId)!.add(invocationId);

    // Update node index
    if (!this.byNode.has(nodeId)) {
      this.byNode.set(nodeId, new Set());
    }
    this.byNode.get(nodeId)!.add(invocationId);

    this.logger.info(
      {
        invocationId,
        nodeId,
        targetConnectionId,
        capability,
        callerConnectionId,
        timeout: effectiveTimeout,
      },
      'Invocation started',
    );

    return {
      ok: true,
      invocationId,
      promise,
    };
  }

  /**
   * Create the RPC request message to send to the node
   */
  createRpcRequest(invocationId: string): NodeRpcRequest | null {
    const pending = this.pending.get(invocationId);
    if (!pending) {
      return null;
    }

    return createWSMessage('node.rpc.request', {
      invocationId,
      capability: pending.capability,
      params: pending.params,
      timeout: pending.timeout,
    }) as NodeRpcRequest;
  }

  /**
   * Handle a successful response from the node
   */
  handleResponse(response: NodeRpcResponse): boolean {
    const pending = this.pending.get(response.payload.invocationId);
    if (!pending) {
      this.logger.warn(
        { invocationId: response.payload.invocationId },
        'Received response for unknown invocation',
      );
      return false;
    }

    // Clear timeout
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    // Calculate duration
    const duration = Date.now() - pending.createdAt;

    // Create success response for caller
    const callerResponse = createWSMessage('node.invoke', {
      result: response.payload.result,
      duration,
    }) as unknown as WSResponse;

    // Resolve the promise
    pending.resolve(callerResponse);

    // Clean up
    this.cleanup(pending);

    this.logger.info(
      { invocationId: pending.invocationId, nodeId: pending.nodeId, duration },
      'Invocation completed successfully',
    );

    return true;
  }

  /**
   * Handle an error response from the node
   */
  handleError(error: NodeRpcError): boolean {
    const pending = this.pending.get(error.payload.invocationId);
    if (!pending) {
      this.logger.warn(
        { invocationId: error.payload.invocationId },
        'Received error for unknown invocation',
      );
      return false;
    }

    // Clear timeout
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    // Create error response for caller
    const callerResponse = createWSMessage('error', {
      requestId: pending.callerRequestId,
      error: error.payload.error,
    }) as ErrorResponse;

    // Resolve with error response (not reject, to allow handler to return it)
    pending.resolve(callerResponse);

    // Clean up
    this.cleanup(pending);

    this.logger.info(
      {
        invocationId: pending.invocationId,
        nodeId: pending.nodeId,
        error: error.payload.error,
      },
      'Invocation failed with error',
    );

    return true;
  }

  /**
   * Handle invocation timeout
   */
  private handleTimeout(invocationId: string): void {
    const pending = this.pending.get(invocationId);
    if (!pending) {
      return;
    }

    // Create timeout error response
    const errorResponse = createWSMessage('error', {
      requestId: pending.callerRequestId,
      error: {
        code: WS_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: `Invocation timed out after ${pending.timeout}ms`,
      },
    }) as ErrorResponse;

    // Resolve with error response
    pending.resolve(errorResponse);

    // Clean up
    this.cleanup(pending);

    this.logger.warn(
      { invocationId, nodeId: pending.nodeId, timeout: pending.timeout },
      'Invocation timed out',
    );
  }

  /**
   * Fail an invocation with an error
   */
  failInvocation(invocationId: string, code: string, message: string): boolean {
    const pending = this.pending.get(invocationId);
    if (!pending) {
      return false;
    }

    // Clear timeout
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    // Create error response
    const errorResponse = createWSMessage('error', {
      requestId: pending.callerRequestId,
      error: { code, message },
    }) as ErrorResponse;

    // Resolve with error response
    pending.resolve(errorResponse);

    // Clean up
    this.cleanup(pending);

    this.logger.info(
      { invocationId, nodeId: pending.nodeId, code },
      'Invocation failed',
    );

    return true;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clean up a single invocation
   */
  private cleanup(pending: PendingInvocation): void {
    // Clear timeout if still set
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    // Remove from main map
    this.pending.delete(pending.invocationId);

    // Remove from caller index
    const callerInvocations = this.byCaller.get(pending.callerConnectionId);
    if (callerInvocations) {
      callerInvocations.delete(pending.invocationId);
      if (callerInvocations.size === 0) {
        this.byCaller.delete(pending.callerConnectionId);
      }
    }

    // Remove from node index
    const nodeInvocations = this.byNode.get(pending.nodeId);
    if (nodeInvocations) {
      nodeInvocations.delete(pending.invocationId);
      if (nodeInvocations.size === 0) {
        this.byNode.delete(pending.nodeId);
      }
    }
  }

  /**
   * Clean up all invocations for a caller connection
   *
   * Called when the caller disconnects. We let pending invocations complete
   * and just drop the response.
   */
  cleanupCallerConnection(connectionId: string): number {
    const invocationIds = this.byCaller.get(connectionId);
    if (!invocationIds) {
      return 0;
    }

    const count = invocationIds.size;

    for (const invocationId of Array.from(invocationIds)) {
      const pending = this.pending.get(invocationId);
      if (pending) {
        const errorResponse = createWSMessage('error', {
          requestId: pending.callerRequestId,
          error: {
            code: WS_ERROR_CODES.CONNECTION_CLOSED,
            message: 'Caller disconnected',
          },
        }) as ErrorResponse;

        pending.resolve(errorResponse);
        this.cleanup(pending);
      }
    }

    this.logger.info(
      { connectionId, count },
      'Cleaned up invocations for disconnected caller',
    );

    return count;
  }

  /**
   * Fail all invocations for a target node
   *
   * Called when the target node disconnects. All pending invocations fail.
   */
  failNodeInvocations(
    nodeId: string,
    reason: string = 'Node disconnected',
  ): number {
    const invocationIds = this.byNode.get(nodeId);
    if (!invocationIds) {
      return 0;
    }

    const count = invocationIds.size;

    for (const invocationId of invocationIds) {
      this.failInvocation(
        invocationId,
        WS_ERROR_CODES.SERVICE_UNAVAILABLE,
        reason,
      );
    }

    this.logger.info(
      { nodeId, count, reason },
      'Failed invocations for disconnected node',
    );

    return count;
  }

  /**
   * Get pending invocation count
   */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * Get pending invocations for a node
   */
  getNodePendingCount(nodeId: string): number {
    return this.byNode.get(nodeId)?.size ?? 0;
  }

  /**
   * Get pending invocations for a caller
   */
  getCallerPendingCount(connectionId: string): number {
    return this.byCaller.get(connectionId)?.size ?? 0;
  }

  /**
   * Check if an invocation is pending
   */
  isPending(invocationId: string): boolean {
    return this.pending.has(invocationId);
  }

  /**
   * Get invocation info (for debugging)
   */
  getInvocation(invocationId: string): PendingInvocation | undefined {
    return this.pending.get(invocationId);
  }

  /**
   * Check whether a connection is the expected responder for an invocation
   */
  isExpectedResponder(invocationId: string, connectionId: string): boolean {
    return this.pending.get(invocationId)?.targetConnectionId === connectionId;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Generate a unique invocation ID
   */
  private generateInvocationId(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Clean up all pending invocations
   */
  clear(): void {
    for (const pending of this.pending.values()) {
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      pending.reject(new Error('Manager cleared'));
    }

    this.pending.clear();
    this.byCaller.clear();
    this.byNode.clear();

    this.logger.info('Invocation manager cleared');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createInvocationManager(
  connectionManager: ConnectionManager,
  logger: FastifyBaseLogger,
  options?: InvocationManagerOptions,
): InvocationManager {
  return new InvocationManager(connectionManager, logger, options);
}
