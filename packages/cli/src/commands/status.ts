/**
 * openaidy status — Report server state (PR2 T2.4)
 *
 * Behavior (per spec R-9):
 *  1. Read PID JSON from $OPENAIDY_HOME/state/server.pid
 *  2. Check process liveness via isProcessAlive
 *  3. Read bootstrap-admin token from config's tokenPath
 *  4. Format output:
 *     - Running: state=running, URL, PID, log path, masked token (****last4)
 *     - Stopped: state=stopped, token status only
 *  5. Token value NEVER appears in stdout in full (only ****<last4>)
 *
 * Design:
 *  - Uses createCLIError / formatCLIError for error paths
 *  - Returns CommandResult per types.ts contract
 *  - Output is human-readable (R-9 contract)
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CommandResult } from '../types.js';
import { isProcessAlive, readPidFile } from '../lib/process-manager.js';

// ============================================================================
// Help text
// ============================================================================

const HELP_TEXT = `
Usage: openaidy status [options]

Show the current status of the OpenAidy server.

Displays:
  - Server state: running or stopped
  - URL and port (when running)
  - Server PID and log path (when running)
  - Bootstrap admin token status (value masked: ****<last4>)

Options:
  -h, --help          Show this help message

Exit Codes:
  0  Status reported successfully (regardless of running/stopped)
`;

// ============================================================================
// Token masking
// ============================================================================

/**
 * Mask a token value for display, showing only the last 4 characters.
 *
 * Exported for testing.
 *
 * @param token - The full token string
 * @returns Masked string like "****wxyz"
 */
export function maskToken(token: string): string {
  const last4 = token.length >= 4 ? token.slice(-4) : token;
  return `****${last4}`;
}

// ============================================================================
// Status Handler
// ============================================================================

/**
 * The `openaidy status` command handler.
 *
 * @param args - CLI arguments
 * @param envOverride - test-only env override (defaults to process.env)
 */
export async function statusHandler(
  args: string[],
  envOverride?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    return { exitCode: 0, output: HELP_TEXT };
  }

  const env = envOverride ?? process.env;
  const home = env.OPENAIDY_HOME ?? process.cwd();
  const pidPath = resolve(home, 'state', 'server.pid');

  // Read PID file
  const rec = await readPidFile(pidPath);

  // Read token for status output
  let tokenValue = '';
  let tokenStatus = 'unknown';
  try {
    const { resolveCLIConfig } = await import('../lib/config.js');
    const cfg = resolveCLIConfig(env);
    const raw = await readFile(cfg.tokenPath, 'utf-8');
    const tokenRecord = JSON.parse(raw) as {
      token?: string;
      expiresAt?: string;
    };
    if (tokenRecord.token) {
      tokenValue = tokenRecord.token;
      tokenStatus = 'present';
      // Check expiration
      if (
        tokenRecord.expiresAt &&
        new Date(tokenRecord.expiresAt) < new Date()
      ) {
        tokenStatus = 'expired';
      }
    } else {
      tokenStatus = 'missing';
    }
  } catch {
    tokenStatus = 'unreadable';
  }

  // Determine process state
  const isRunning = rec !== null && isProcessAlive(rec.pid);

  let output: string;

  if (isRunning && rec) {
    output = [
      `State: running`,
      `URL: http://localhost:${rec.port}`,
      `PID: ${rec.pid}`,
      `Log file: ${rec.logFile}`,
      `Token: ${tokenStatus} (value masked: ${tokenValue ? maskToken(tokenValue) : 'N/A'})`,
    ].join('\n');
  } else {
    // Stopped: report state + token info only
    output = [
      `State: stopped`,
      `Token: ${tokenStatus}${tokenValue ? ` (value masked: ${maskToken(tokenValue)})` : ''}`,
    ].join('\n');
  }

  return { exitCode: 0, output };
}
