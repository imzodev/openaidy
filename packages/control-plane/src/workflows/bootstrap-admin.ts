/**
 * Control Plane - Bootstrap Admin Workflow
 * 
 * Provides workflow-oriented interface for bootstrap admin operations.
 * This layer normalizes results and errors for CLI consumption while
 * remaining independent from terminal formatting.
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  type WorkflowResult,
  type WorkflowError,
  type BootstrapAdminTokenStatus,
  type BootstrapAdminTokenData,
  type BootstrapAdminInspectResult,
  success,
  failure,
} from '../types.js';

// Re-export types for consumers
export type {
  WorkflowResult,
  WorkflowError,
  BootstrapAdminTokenStatus,
  BootstrapAdminTokenData,
  BootstrapAdminInspectResult,
};

// ============================================================================
// Workflow Options
// ============================================================================

/**
 * Options for bootstrap admin inspection workflow.
 */
export type BootstrapAdminInspectOptions = {
  enabled: boolean;
  tokenPath: string;
  jwtSecret: string;
  logger?: FastifyBaseLogger;
};

// ============================================================================
// Workflow Context
// ============================================================================

/**
 * Context passed to bootstrap admin workflows.
 * Provides access to low-level server modules.
 */
export type BootstrapAdminContext = {
  /** Whether bootstrap admin is enabled */
  enabled: boolean;
  /** Path to the token file */
  tokenPath: string;
  /** JWT secret for token validation */
  jwtSecret: string;
  /** Logger instance */
  logger?: FastifyBaseLogger;
};

// ============================================================================
// Bootstrap Admin Workflow Service
// ============================================================================

/**
 * Bootstrap Admin Workflow Service
 * 
 * Provides workflow-oriented methods for bootstrap admin operations.
 * This service wraps low-level server modules and normalizes results.
 */
export class BootstrapAdminWorkflow {
  private context: BootstrapAdminContext;

  constructor(context: BootstrapAdminContext) {
    this.context = context;
  }

  /**
   * Inspect bootstrap admin token state.
   * 
   * This is a read-only operation that checks token validity
   * without creating or modifying any tokens.
   */
  async inspectToken(): Promise<BootstrapAdminInspectResult> {
    const { enabled, tokenPath, jwtSecret, logger } = this.context;

    // Check if bootstrap-admin is disabled
    if (!enabled) {
      logger?.info({ tokenPath }, 'Bootstrap admin is disabled');
      return success({
        status: 'disabled' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: false,
      });
    }

    // Dynamically import server module to avoid circular dependencies
    const { inspectBootstrapAdminToken } = await import(
      '@openaidy/server/bootstrap-admin-inspect'
    );

    // Delegate to server-level inspection function
    const result = await inspectBootstrapAdminToken({
      enabled,
      tokenPath,
      jwtSecret,
      logger,
    });

    // Map server result to workflow result
    return success({
      status: result.status as BootstrapAdminTokenStatus,
      tokenPath: result.tokenPath,
      enabled: result.enabled,
      record: result.record,
    });
  }

  /**
   * Get the path to the bootstrap admin token file.
   */
  getTokenPath(): string {
    return this.context.tokenPath;
  }

  /**
   * Check if bootstrap admin is enabled.
   */
  isEnabled(): boolean {
    return this.context.enabled;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a bootstrap admin workflow service.
 */
export function createBootstrapAdminWorkflow(
  context: BootstrapAdminContext,
): BootstrapAdminWorkflow {
  return new BootstrapAdminWorkflow(context);
}
