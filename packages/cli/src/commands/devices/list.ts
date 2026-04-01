/**
 * Devices List Command Handler
 * 
 * Implements `openaidy devices list` command.
 * Uses the control-plane pairing workflow for request retrieval.
 */

import {
  PairingWorkflow,
  createPairingWorkflow,
  type PairingContext,
  type PairingRequestData,
} from '@openaidy/control-plane';
import {
  formatRequestList,
  formatEmptyState,
  sortRequestsByDate,
} from '../../formatters/devices.js';
import type { CommandResult } from '../../types.js';

/**
 * Options for devices list command
 */
export interface DevicesListOptions {
  /** Filter by status (default: pending) */
  status?: 'pending' | 'approved' | 'denied' | 'expired' | 'all';
  /** Maximum number of results */
  limit?: number;
}

/**
 * Result from devices list command
 */
export interface DevicesListResult {
  requests: PairingRequestData[];
  count: number;
  filteredBy: string;
}

/**
 * Create a devices list handler with optional workflow context.
 * 
 * This allows:
 * - Testing with mock pairing service
 * - Production use with real pairing service
 */
export function createDevicesListHandler(
  getContext?: () => PairingContext | null,
) {
  return async (args: string[]): Promise<CommandResult> => {
    // Handle help flag
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy devices list [options]

List device pairing requests.

Options:
  --status <status>  Filter by status: pending, approved, denied, expired, all
                     (default: pending)
  --limit <n>        Maximum number of results (default: 50)

Examples:
  pnpm openaidy devices list
  pnpm openaidy devices list --status all
  pnpm openaidy devices list --status approved --limit 10

Exit Codes:
  0  Success (including empty result)
  1  Error retrieving requests
`,
      };
    }

    // Parse options
    const options = parseDevicesListArgs(args);
    
    // Get context (pairing service connection)
    const context = getContext?.();
    
    if (!context) {
      // No context available - return stub response
      return {
        exitCode: 0,
        output: formatEmptyState(),
      };
    }

    try {
      // Create workflow and list requests
      const workflow = createPairingWorkflow(context);
      const status = options.status === 'all' ? undefined : options.status;
      
      const result = workflow.listRequests(
        status ? { status } : undefined
      );

      if (!result.success) {
        return {
          exitCode: 1,
          error: `Error: ${result.error?.message || 'Failed to list requests'}`,
        };
      }

      let requests = result.data?.requests || [];
      
      // Sort by date (newest first)
      requests = sortRequestsByDate(requests);
      
      // Apply limit
      if (options.limit && options.limit > 0) {
        requests = requests.slice(0, options.limit);
      }

      // Format output
      const output = requests.length > 0
        ? formatRequestList(requests, getTitle(options.status))
        : formatEmptyState(options.status || 'pending');

      return {
        exitCode: 0,
        output,
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
 * Parse command line arguments for devices list
 */
function parseDevicesListArgs(args: string[]): DevicesListOptions {
  const options: DevicesListOptions = {
    status: 'pending',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--status' && args[i + 1]) {
      const status = args[i + 1];
      if (['pending', 'approved', 'denied', 'expired', 'all'].includes(status)) {
        options.status = status as DevicesListOptions['status'];
      }
      i++;
    } else if (arg === '--limit' && args[i + 1]) {
      const limit = parseInt(args[i + 1], 10);
      if (!isNaN(limit) && limit > 0) {
        options.limit = limit;
      }
      i++;
    }
  }

  return options;
}

/**
 * Get title for the request list based on status filter
 */
function getTitle(status?: string): string {
  switch (status) {
    case 'approved':
      return 'Approved Device Pairing Requests';
    case 'denied':
      return 'Denied Device Pairing Requests';
    case 'expired':
      return 'Expired Device Pairing Requests';
    case 'all':
      return 'All Device Pairing Requests';
    default:
      return 'Pending Device Pairing Requests';
  }
}

// Default handler without context (stub)
export const devicesListHandler = createDevicesListHandler();
