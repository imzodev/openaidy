/**
 * Devices Approve Command Handler
 * 
 * Implements `openaidy devices approve <request-id>` command.
 * Uses the control-plane pairing workflow for approval.
 */

import {
  PairingWorkflow,
  createPairingWorkflow,
  type PairingContext,
  type PairingRequestData,
} from '@openaidy/control-plane';
import { formatRequest } from '../../formatters/devices.js';
import type { CommandResult } from '../../types.js';

/**
 * Options for devices approve command
 */
export interface DevicesApproveOptions {
  /** Override scopes (comma-separated) */
  scopes?: string[];
}

/**
 * Create a devices approve handler with optional workflow context.
 */
export function createDevicesApproveHandler(
  getContext?: () => PairingContext | null,
) {
  return async (args: string[]): Promise<CommandResult> => {
    // Handle help flag
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy devices approve <request-id> [options]

Approve a pending device pairing request.

Arguments:
  request-id         The ID of the pairing request to approve

Options:
  --scopes <scopes>  Override granted scopes (comma-separated)

Examples:
  pnpm openaidy devices approve abc123
  pnpm openaidy devices approve abc123 --scopes chat,files

Exit Codes:
  0  Request approved successfully
  1  Request not found, already processed, or error
`,
      };
    }

    // Parse arguments
    const { requestId, options } = parseApproveArgs(args);
    
    if (!requestId) {
      return {
        exitCode: 1,
        error: 'Error: Missing required argument <request-id>\n\nUsage: openaidy devices approve <request-id>',
      };
    }

    // Get context
    const context = getContext?.();
    
    if (!context) {
      return {
        exitCode: 1,
        error: 'Error: No pairing service connection available',
      };
    }

    try {
      const workflow = createPairingWorkflow(context);
      const result = await workflow.approveRequest(requestId, options.scopes);

      if (!result.success) {
        return formatError(result.error?.code, result.error?.message, requestId);
      }

      const request = result.data!;
      
      return {
        exitCode: 0,
        output: formatSuccess('approved', request),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        error: `Error: ${message}`,
      };
    }
  };
}

/**
 * Parse command line arguments for devices approve
 */
function parseApproveArgs(args: string[]): {
  requestId: string | null;
  options: DevicesApproveOptions;
} {
  let requestId: string | null = null;
  const options: DevicesApproveOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--scopes' && args[i + 1]) {
      options.scopes = args[i + 1].split(',').map(s => s.trim());
      i++;
    } else if (!arg.startsWith('-') && !requestId) {
      requestId = arg;
    }
  }

  return { requestId, options };
}

/**
 * Format success message
 */
function formatSuccess(action: 'approved', request: PairingRequestData): string {
  const lines: string[] = [];
  
  lines.push(`Pairing Request ${action.toUpperCase()}`);
  lines.push('='.repeat(20));
  lines.push('');
  lines.push(formatRequest(request));
  lines.push('');
  lines.push(`Device "${request.deviceName}" has been ${action}.`);
  
  return lines.join('\n');
}

/**
 * Format error message based on error code
 */
function formatError(
  code?: string,
  message?: string,
  requestId?: string,
): CommandResult {
  const exitCode = 1;
  
  switch (code) {
    case 'PAIRING_REQUEST_NOT_FOUND':
      return {
        exitCode,
        error: `Error: Pairing request not found: ${requestId}`,
      };
    case 'PAIRING_REQUEST_EXPIRED':
      return {
        exitCode,
        error: `Error: Pairing request has expired: ${requestId}`,
      };
    case 'PAIRING_REQUEST_ALREADY_PROCESSED':
      return {
        exitCode,
        error: `Error: ${message || 'Request already processed'}`,
      };
    default:
      return {
        exitCode,
        error: `Error: ${message || 'Failed to approve request'}`,
      };
  }
}

// Default handler
export const devicesApproveHandler = createDevicesApproveHandler();
