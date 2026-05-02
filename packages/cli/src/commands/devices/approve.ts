/**
 * Devices Approve Command Handler
 *
 * Implements `openaidy devices approve <request-id>` command.
 * Uses the control-plane pairing workflow for approval.
 */

import * as p from '@clack/prompts';
import {
  createPairingWorkflow,
  type PairingContext,
} from '@openaidy/control-plane';
import { formatRequest } from '../../formatters/devices.js';
import type { CommandResult, DevicesApproveOptions } from '../../types.js';

/**
 * Create a devices approve handler with optional workflow context.
 */
export function createDevicesApproveHandler(
  getContext?: () => PairingContext | null,
) {
  return async (args: string[]): Promise<CommandResult> => {
    if (args.includes('-h') || args.includes('--help')) {
      p.note(
        [
          'Usage: openaidy devices approve <request-id> [options]',
          '',
          'Arguments:',
          '  request-id         The ID of the pairing request to approve',
          '',
          'Options:',
          '  --scopes <scopes>  Override granted scopes (comma-separated)',
          '',
          'Examples:',
          '  pnpm openaidy devices approve abc123',
          '  pnpm openaidy devices approve abc123 --scopes chat,files',
        ].join('\n'),
        'devices approve',
      );
      return { exitCode: 0 };
    }

    const { requestId, options } = parseApproveArgs(args);

    if (!requestId) {
      const error =
        'Error: Missing required argument <request-id>\n\nUsage: openaidy devices approve <request-id>';
      p.log.error(error);
      return { exitCode: 1, error };
    }

    const context = getContext?.();

    if (!context) {
      const error = 'Error: No pairing service connection available';
      p.log.error(error);
      return { exitCode: 1, error };
    }

    const s = p.spinner();
    s.start(`Approving request ${requestId}…`);

    try {
      const workflow = createPairingWorkflow(context);
      const result = await workflow.approveRequest(requestId, options.scopes);

      if (!result.success) {
        s.stop('Failed.');
        return formatError(
          result.error?.code,
          result.error?.message,
          requestId,
        );
      }

      const request = result.data!;
      s.stop('Approved.');
      p.outro(`Device "${request.deviceName}" has been approved.`);
      p.note(formatRequest(request), 'Request Details');
      return { exitCode: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      s.stop('Failed.');
      p.log.error(`Error: ${message}`);
      return { exitCode: 1, error: `Error: ${message}` };
    }
  };
}

function parseApproveArgs(args: string[]): {
  requestId: string | null;
  options: DevicesApproveOptions;
} {
  let requestId: string | null = null;
  const options: DevicesApproveOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--scopes' && args[i + 1]) {
      options.scopes = args[i + 1].split(',').map((s) => s.trim());
      i++;
    } else if (!arg.startsWith('-') && !requestId) {
      requestId = arg;
    }
  }

  return { requestId, options };
}

function formatError(
  code?: string,
  message?: string,
  requestId?: string,
): CommandResult {
  let error: string;
  switch (code) {
    case 'PAIRING_REQUEST_NOT_FOUND':
      error = `Error: Pairing request not found: ${requestId}`;
      break;
    case 'PAIRING_REQUEST_EXPIRED':
      error = `Error: Pairing request has expired: ${requestId}`;
      break;
    case 'PAIRING_REQUEST_ALREADY_PROCESSED':
      error = `Error: ${message || 'Request already processed'}`;
      break;
    default:
      error = `Error: ${message || 'Failed to approve request'}`;
  }
  p.log.error(error);
  return { exitCode: 1, error };
}

export const devicesApproveHandler = createDevicesApproveHandler();
