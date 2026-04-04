/**
 * Admin Workflow Helper
 *
 * Creates a BootstrapAdminWorkflow instance configured from CLI settings.
 * Shared by all `admin token *` commands.
 */

import {
  BootstrapAdminWorkflow,
  type BootstrapAdminContext,
  type BootstrapAdminInspectResult,
} from '@openaidy/control-plane';
import { resolveCLIConfig } from './config.js';

/**
 * Create a BootstrapAdminWorkflow configured from environment/config.
 *
 * @returns The workflow instance and the resolved token path
 */
export function createAdminWorkflow(): {
  workflow: BootstrapAdminWorkflow;
  tokenPath: string;
} {
  const config = resolveCLIConfig();

  const context: BootstrapAdminContext = {
    enabled: config.bootstrapAdminEnabled,
    tokenPath: config.tokenPath,
    jwtSecret: config.jwtSecret,
  };

  return {
    workflow: new BootstrapAdminWorkflow(context),
    tokenPath: config.tokenPath,
  };
}

/**
 * Format a BootstrapAdminInspectResult as human-readable terminal output.
 */
export function formatTokenInspection(
  result: BootstrapAdminInspectResult,
): string {
  if (!result.success || !result.data) {
    const errMsg = result.error?.message ?? 'Unknown error';
    return `Bootstrap Admin Token\n========================\n\nError: ${errMsg}`;
  }

  const { status, tokenPath, enabled, record } = result.data;

  let output = `Bootstrap Admin Token\n========================\n\n`;
  output += `Status:    ${status}\n`;
  output += `Path:      ${tokenPath}\n`;
  output += `Enabled:   ${enabled}\n`;

  if (record) {
    output += `\nClient ID: ${record.clientId}\n`;
    output += `Created:   ${record.createdAt}\n`;
    output += `Expires:   ${record.expiresAt}\n`;
    output += `Scopes:    ${record.scopes.join(', ')}\n`;
  }

  if (status === 'missing') {
    output += `\nNo token file found. Start the server to generate one:\n`;
    output += `  pnpm --filter @openaidy/server dev\n`;
  } else if (status === 'expired') {
    output += `\nThe token has expired. Delete the token file and restart the server:\n`;
    output += `  rm ${tokenPath}\n`;
    output += `  pnpm --filter @openaidy/server dev\n`;
  } else if (status === 'disabled') {
    output += `\nBootstrap admin is disabled. Set BOOTSTRAP_ADMIN_ENABLED=true to enable.\n`;
  }

  return output;
}

export type { BootstrapAdminInspectResult };
