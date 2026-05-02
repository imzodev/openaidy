/**
 * Devices Deny Command Handler
 *
 * Implements `openaidy devices deny <request-id>` command.
 * Uses the control-plane pairing workflow for denial.
 */

import * as p from '@clack/prompts';
import {
  createPairingWorkflow,
  type PairingContext,
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
    if (args.includes('-h') || args.includes('--help')) {
      p.note(
        [
          'Usage: openaidy devices deny <request-id>',
          '',
          'Arguments:',
          '  request-id    The ID of the pairing request to deny',
          '',
          'Examples:',
          '  pnpm openaidy devices deny abc123',
        ].join('\n'),
        'devices deny',
      );
      return { exitCode: 0 };
    }

    const requestId = parseDenyArgs(args);

    if (!requestId) {
      const error =
        'Error: Missing required argument <request-id>\n\nUsage: openaidy devices deny <request-id>';
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
    s.start(`Denying request ${requestId}…`);

    try {
      const workflow = createPairingWorkflow(context);
      const result = workflow.denyRequest(requestId);

      if (!result.success) {
        s.stop('Failed.');
        return formatError(
          result.error?.code,
          result.error?.message,
          requestId,
        );
      }

      const request = result.data!;
      s.stop('Denied.');
      p.outro(`Device "${request.deviceName}" has been denied.`);
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

function parseDenyArgs(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith('-')) return arg;
  }
  return null;
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
      error = `Error: ${message || 'Failed to deny request'}`;
  }
  p.log.error(error);
  return { exitCode: 1, error };
}

export const devicesDenyHandler = createDevicesDenyHandler();
