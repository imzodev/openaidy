/**
 * @openaidy/control-plane
 * 
 * Shared control-plane application layer for admin workflows.
 * This package provides workflow-oriented interfaces that sit between
 * the CLI and low-level server/domain modules.
 * 
 * Design Goals:
 * - CLI remains thin - just routing and rendering
 * - Future admin surfaces (web UI, remote API) can reuse these workflows
 * - Normalized results and errors suitable for JSON output
 * - Clean dependency boundaries
 */

// Types
export type {
  WorkflowResult,
  WorkflowError,
  WorkflowErrorCode,
  BootstrapAdminTokenStatus,
  BootstrapAdminTokenData,
  BootstrapAdminInspectResult,
  PairingRequestStatus,
  PairingRequestData,
  ListPairingRequestsResult,
  PairingRequestActionResult,
} from './types.js';

// Helper functions
export { success, failure } from './types.js';

// Bootstrap Admin Workflow
export {
  BootstrapAdminWorkflow,
  createBootstrapAdminWorkflow,
  type BootstrapAdminContext,
  type WorkflowLogger as BootstrapAdminLogger,
} from './workflows/bootstrap-admin.js';

// Pairing Workflow
export {
  PairingWorkflow,
  createPairingWorkflow,
  type PairingContext,
  type PairingWorkflowOptions,
  type ListRequestsOptions,
} from './workflows/pairing.js';
