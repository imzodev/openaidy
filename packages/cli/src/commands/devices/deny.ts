/**
 * Devices Deny Command Handler
 * 
 * Implements `openaidy devices deny <request-id>` command.
 * Uses the control-plane pairing workflow for denial.
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
 * Create a devices deny handler with optional workflow context.
 */
export function createDevicesDenyHandler(
  getContext?: () => PairingContext | null,
) {
  return async (args: string[]): Promise<CommandResult> => {
    // Handle help flag
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy devices deny <request-id>

Deny a pending device pairing request.

Arguments:
  request-id    The ID of the pairing request to deny

Examples:
  pnpm openaidy devices deny abc123

Exit Codes:
  0  Request denied successfully
  1  Request not found, already processed, or error
`,
      };
    }

    // Parse arguments
    const requestId = parseDenyArgs(args);
    
    if (!requestId) {
      return {
        exitCode: 1,
        error: 'Error: Missing required argument <request-id>\n\nUsage: openaidy devices deny <request-id>',
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
      const result = workflow.denyRequest(requestId);

      if (!result.success) {
        return formatError(result.error?.code, result.error?.message, requestId);
      }

      const request = result.data!;
      
      return {
        exitCode: 0,
        output: formatSuccess(request),
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
 * Parse command line arguments for devices deny
 */
function parseDenyArgs(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      return arg;
    }
  }
  return null;
}

/**
 * Format success message
 */
function formatSuccess(request: PairingRequestData): string {
  const lines: string[] = [];
  
  lines.push('Pairing Request DENIED');
  lines.push('='.repeat(22));
  lines.push('');
  lines.push(formatRequest(request));
  lines.push('');
  lines.push(`Device "${request.deviceName}" has been denied.`);
  
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
        error: `Error: ${message || 'Failed to deny request'}`,
      };
  }
}

// Default handler
export const devicesDenyHandler = createDevicesDenyHandler();
