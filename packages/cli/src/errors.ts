/**
 * CLI Error Model
 *
 * Centralized error handling with consistent categories, messages, and exit codes.
 * Designed to support future JSON output while providing clear human-readable messages.
 */

import type { CommandResult } from './types.js';

// ============================================================================
// Error Categories
// ============================================================================

/**
 * Standardized CLI error categories.
 * Each category maps to a specific exit code and message template.
 */
export type CLIErrorCategory =
  // Configuration errors
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'

  // Bootstrap admin errors
  | 'BOOTSTRAP_DISABLED'
  | 'BOOTSTRAP_TOKEN_MISSING'
  | 'BOOTSTRAP_TOKEN_MALFORMED'
  | 'BOOTSTRAP_TOKEN_INVALID'
  | 'BOOTSTRAP_TOKEN_EXPIRED'

  // Pairing request errors
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_ALREADY_APPROVED'
  | 'REQUEST_ALREADY_DENIED'
  | 'REQUEST_EXPIRED'
  | 'REQUEST_NOT_PENDING'

  // Argument errors
  | 'ARGUMENT_MISSING'
  | 'ARGUMENT_INVALID'
  | 'COMMAND_UNKNOWN'
  | 'SUBCOMMAND_UNKNOWN'

  // System errors
  | 'SERVICE_UNAVAILABLE'
  | 'PERSISTENCE_FAILURE'
  | 'INTERNAL_ERROR'
  | 'PERMISSION_DENIED';

// ============================================================================
// Error Info
// ============================================================================

/**
 * Structured error information.
 */
export interface CLIErrorInfo {
  category: CLIErrorCategory;
  message: string;
  exitCode: number;
  details?: Record<string, unknown>;
}

// ============================================================================
// Error Definitions
// ============================================================================

/**
 * Error definitions with default messages and exit codes.
 */
const ErrorDefinitions: Record<
  CLIErrorCategory,
  {
    defaultMessage: string;
    exitCode: number;
  }
> = {
  // Configuration errors (exit 5)
  CONFIG_MISSING: {
    defaultMessage: 'Configuration file not found',
    exitCode: 5,
  },
  CONFIG_INVALID: {
    defaultMessage: 'Configuration is invalid',
    exitCode: 5,
  },

  // Bootstrap admin errors (exit 1)
  BOOTSTRAP_DISABLED: {
    defaultMessage: 'Bootstrap admin is disabled',
    exitCode: 1,
  },
  BOOTSTRAP_TOKEN_MISSING: {
    defaultMessage: 'Bootstrap admin token not found',
    exitCode: 1,
  },
  BOOTSTRAP_TOKEN_MALFORMED: {
    defaultMessage: 'Bootstrap admin token is malformed',
    exitCode: 1,
  },
  BOOTSTRAP_TOKEN_INVALID: {
    defaultMessage: 'Bootstrap admin token is invalid',
    exitCode: 1,
  },
  BOOTSTRAP_TOKEN_EXPIRED: {
    defaultMessage: 'Bootstrap admin token has expired',
    exitCode: 1,
  },

  // Pairing request errors (exit 1)
  REQUEST_NOT_FOUND: {
    defaultMessage: 'Pairing request not found',
    exitCode: 1,
  },
  REQUEST_ALREADY_APPROVED: {
    defaultMessage: 'Pairing request has already been approved',
    exitCode: 1,
  },
  REQUEST_ALREADY_DENIED: {
    defaultMessage: 'Pairing request has already been denied',
    exitCode: 1,
  },
  REQUEST_EXPIRED: {
    defaultMessage: 'Pairing request has expired',
    exitCode: 1,
  },
  REQUEST_NOT_PENDING: {
    defaultMessage: 'Pairing request is not in pending state',
    exitCode: 1,
  },

  // Argument errors (exit 2)
  ARGUMENT_MISSING: {
    defaultMessage: 'Required argument missing',
    exitCode: 2,
  },
  ARGUMENT_INVALID: {
    defaultMessage: 'Invalid argument value',
    exitCode: 2,
  },
  COMMAND_UNKNOWN: {
    defaultMessage: 'Unknown command',
    exitCode: 2,
  },
  SUBCOMMAND_UNKNOWN: {
    defaultMessage: 'Unknown subcommand',
    exitCode: 2,
  },

  // System errors (exit 1)
  SERVICE_UNAVAILABLE: {
    defaultMessage: 'Service is unavailable',
    exitCode: 1,
  },
  PERSISTENCE_FAILURE: {
    defaultMessage: 'Failed to persist changes',
    exitCode: 1,
  },
  INTERNAL_ERROR: {
    defaultMessage: 'An internal error occurred',
    exitCode: 1,
  },
  PERMISSION_DENIED: {
    defaultMessage: 'Permission denied',
    exitCode: 4,
  },
};

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create a CLI error with category, message, and exit code.
 */
export function createCLIError(
  category: CLIErrorCategory,
  message?: string,
  details?: Record<string, unknown>,
): CLIErrorInfo {
  const definition = ErrorDefinitions[category];
  return {
    category,
    message: message || definition.defaultMessage,
    exitCode: definition.exitCode,
    details,
  };
}

/**
 * Format error for human-readable output.
 */
export function formatCLIError(error: CLIErrorInfo): string {
  const lines: string[] = [];

  lines.push(`Error: ${error.message}`);

  if (error.details) {
    const hint = getHintFromDetails(error.category, error.details);
    if (hint) {
      lines.push('');
      lines.push(hint);
    }
  }

  return lines.join('\n');
}

/**
 * Convert CLI error to CommandResult.
 */
export function errorToResult(error: CLIErrorInfo): CommandResult {
  return {
    exitCode: error.exitCode,
    error: formatCLIError(error),
  };
}

/**
 * Get contextual hint from error details.
 */
function getHintFromDetails(
  category: CLIErrorCategory,
  details: Record<string, unknown>,
): string | null {
  switch (category) {
    case 'ARGUMENT_MISSING':
      if (details.usage) {
        return `Usage: ${details.usage}`;
      }
      break;
    case 'COMMAND_UNKNOWN':
      if (details.suggestion) {
        return `Did you mean: ${details.suggestion}?`;
      }
      break;
    case 'BOOTSTRAP_TOKEN_MISSING':
      return 'Run: openaidy admin token create';
    case 'REQUEST_EXPIRED':
      if (details.expiredAt) {
        return `Request expired at: ${details.expiredAt}`;
      }
      break;
  }
  return null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create and format an error in one step.
 */
export function cliError(
  category: CLIErrorCategory,
  message?: string,
  details?: Record<string, unknown>,
): CommandResult {
  return errorToResult(createCLIError(category, message, details));
}

/**
 * Create argument missing error.
 */
export function argMissing(argName: string, usage?: string): CommandResult {
  return cliError('ARGUMENT_MISSING', `Missing required argument: ${argName}`, {
    argument: argName,
    usage,
  });
}

/**
 * Create unknown command error.
 */
export function unknownCommand(
  command: string,
  suggestion?: string,
): CommandResult {
  return cliError('COMMAND_UNKNOWN', `Unknown command: ${command}`, {
    command,
    suggestion,
  });
}

/**
 * Create unknown subcommand error.
 */
export function unknownSubcommand(
  group: string,
  subcommand: string,
): CommandResult {
  return cliError(
    'SUBCOMMAND_UNKNOWN',
    `Unknown subcommand: ${group} ${subcommand}`,
    { group, subcommand },
  );
}

/**
 * Create request not found error.
 */
export function requestNotFound(requestId: string): CommandResult {
  return cliError(
    'REQUEST_NOT_FOUND',
    `Pairing request not found: ${requestId}`,
    { requestId },
  );
}

/**
 * Create service unavailable error.
 */
export function serviceUnavailable(): CommandResult {
  return cliError(
    'SERVICE_UNAVAILABLE',
    'No pairing service connection available. Ensure the server is running.',
  );
}

// ============================================================================
// Map Control-Plane Errors to CLI Errors
// ============================================================================

/**
 * Map control-plane workflow error codes to CLI error categories.
 */
export function mapWorkflowError(code: string, message?: string): CLIErrorInfo {
  const mapping: Record<string, CLIErrorCategory> = {
    // Bootstrap errors
    BOOTSTRAP_ADMIN_DISABLED: 'BOOTSTRAP_DISABLED',
    BOOTSTRAP_ADMIN_TOKEN_MISSING: 'BOOTSTRAP_TOKEN_MISSING',
    BOOTSTRAP_ADMIN_TOKEN_MALFORMED: 'BOOTSTRAP_TOKEN_MALFORMED',
    BOOTSTRAP_ADMIN_TOKEN_INVALID: 'BOOTSTRAP_TOKEN_INVALID',
    BOOTSTRAP_ADMIN_TOKEN_EXPIRED: 'BOOTSTRAP_TOKEN_EXPIRED',

    // Pairing errors
    PAIRING_REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
    PAIRING_REQUEST_EXPIRED: 'REQUEST_EXPIRED',
    PAIRING_REQUEST_ALREADY_PROCESSED: 'REQUEST_NOT_PENDING',

    // General errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    INVALID_INPUT: 'ARGUMENT_INVALID',
  };

  const category = mapping[code] || 'INTERNAL_ERROR';
  return createCLIError(category, message);
}
