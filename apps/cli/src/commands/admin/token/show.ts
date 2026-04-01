/**
 * Handler for `openaidy admin token show` command
 * 
 * Displays the current bootstrap-admin token information.
 */

import type { CommandResult } from '../../index.ts';
import {
  inspectBootstrapAdminToken,
  formatTokenDisplay,
  type BootstrapAdminInspectOptions,
} from '@openaidy/server/bootstrap-admin-inspect';

/**
 * Default JWT secret for validation.
 * In production, this should come from environment.
 */
const DEFAULT_JWT_SECRET = 'change-me-in-production';

/**
 * Get JWT secret from environment or use default.
 */
function getJwtSecret(): string {
  return process.env.WS_TOKEN_SECRET ?? DEFAULT_JWT_SECRET;
}

/**
 * Get bootstrap admin configuration from environment.
 */
function getBootstrapAdminConfig(): {
  enabled: boolean;
  tokenPath: string;
} {
  const enabled = process.env.BOOTSTRAP_ADMIN_ENABLED !== 'false';
  const tokenPath = process.env.BOOTSTRAP_ADMIN_TOKEN_PATH ??
    // Default path relative to workspace root
    new URL('../../../../../.openaidy/credentials/bootstrap-admin.json', import.meta.url).pathname;

  return { enabled, tokenPath };
}

/**
 * Show help text for this command.
 */
function showHelp(): string {
  return `
Usage: openaidy admin token show

Show the current bootstrap-admin token information.

This command displays:
  - Token status (valid, expired, missing, malformed, invalid, disabled)
  - Token file path
  - Token value (only for valid/expired tokens)
  - Metadata (client ID, created, expires, scopes)

Examples:
  pnpm openaidy admin token show

Environment Variables:
  BOOTSTRAP_ADMIN_ENABLED    Enable/disable bootstrap admin (default: true)
  BOOTSTRAP_ADMIN_TOKEN_PATH Path to token file
  WS_TOKEN_SECRET            JWT secret for token validation

Exit Codes:
  0  Token is valid
  1  Token is disabled, missing, malformed, invalid, or expired
`;
}

/**
 * Handle `openaidy admin token show` command.
 */
export async function handleAdminTokenShow(args: string[]): Promise<CommandResult> {
  // Handle help flag
  if (args.includes('-h') || args.includes('--help')) {
    return {
      exitCode: 0,
      output: showHelp(),
    };
  }

  const config = getBootstrapAdminConfig();

  const options: BootstrapAdminInspectOptions = {
    enabled: config.enabled,
    tokenPath: config.tokenPath,
    jwtSecret: getJwtSecret(),
    // Don't use a logger to avoid noise in CLI output
  };

  const result = await inspectBootstrapAdminToken(options);
  const output = formatTokenDisplay(result);

  // Determine exit code based on status
  // Exit 0 only for valid tokens
  const exitCode = result.status === 'valid' ? 0 : 1;

  return {
    exitCode,
    output,
  };
}
