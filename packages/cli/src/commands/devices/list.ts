/**
 * Devices List Command Handler
 *
 * Implements `openaidy devices list` command.
 * Uses the control-plane pairing workflow for request retrieval.
 */

import * as p from '@clack/prompts';
import {
  createPairingWorkflow,
  type PairingContext,
} from '@openaidy/control-plane';
import {
  formatRequestList,
  formatEmptyState,
  sortRequestsByDate,
} from '../../formatters/devices.js';
import type { CommandResult, DevicesListOptions } from '../../types.js';

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
    if (args.includes('-h') || args.includes('--help')) {
      p.note(
        [
          'Usage: openaidy devices list [options]',
          '',
          'Options:',
          '  --status <status>  Filter by status: pending, approved, denied, expired, all',
          '                     (default: pending)',
          '  --limit <n>        Maximum number of results (default: 50)',
          '',
          'Examples:',
          '  pnpm openaidy devices list',
          '  pnpm openaidy devices list --status all',
          '  pnpm openaidy devices list --status approved --limit 10',
        ].join('\n'),
        'devices list',
      );
      return { exitCode: 0 };
    }

    const options = parseDevicesListArgs(args);
    const context = getContext?.();

    if (!context) {
      p.note(formatEmptyState(), 'Device Pairing Requests');
      return { exitCode: 0 };
    }

    const s = p.spinner();
    s.start('Fetching device pairing requests…');

    try {
      const workflow = createPairingWorkflow(context);
      const status = options.status === 'all' ? undefined : options.status;
      const result = workflow.listRequests(status ? { status } : undefined);

      if (!result.success) {
        const msg = `Error: ${result.error?.message || 'Failed to list requests'}`;
        s.stop('Failed.');
        p.log.error(msg);
        return { exitCode: 1, error: msg };
      }

      let requests = result.data?.requests || [];
      requests = sortRequestsByDate(requests);
      if (options.limit && options.limit > 0) {
        requests = requests.slice(0, options.limit);
      }

      s.stop('Done.');

      const text =
        requests.length > 0
          ? formatRequestList(requests, getTitle(options.status))
          : formatEmptyState(options.status || 'pending');

      p.note(text, getTitle(options.status));
      return { exitCode: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      s.stop('Failed.');
      p.log.error(`Error: ${message}`);
      return { exitCode: 1, error: `Error: ${message}` };
    }
  };
}

function parseDevicesListArgs(args: string[]): DevicesListOptions {
  const options: DevicesListOptions = { status: 'pending' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--status' && args[i + 1]) {
      const status = args[i + 1];
      if (
        ['pending', 'approved', 'denied', 'expired', 'all'].includes(status)
      ) {
        options.status = status as DevicesListOptions['status'];
      }
      i++;
    } else if (arg === '--limit' && args[i + 1]) {
      const limit = parseInt(args[i + 1], 10);
      if (!isNaN(limit) && limit > 0) options.limit = limit;
      i++;
    }
  }

  return options;
}

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

export const devicesListHandler = createDevicesListHandler();
