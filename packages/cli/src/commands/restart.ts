/**
 * openaidy restart — Stop the running OpenAidy server, then start a fresh one
 * (stop + start, atomically from the user's perspective).
 *
 * Design:
 *  - Reuses `stopHandler` and `startHandler` directly (not via spawn) so the
 *    behavior stays in lockstep with the standalone commands. No duplicate PID
 *    handling, no risk of drift.
 *  - Port is preserved across the bounce by reading the previous port from the
 *    PID file. The user does not have to repeat `--port`.
 *  - Mutual exclusion of `--server-only` + `--integrated` is checked BEFORE
 *    any process is killed, so a misconfigured call never leaves the server
 *    down with a stop already issued.
 *  - If `stop` fails, `start` is NOT attempted — that would otherwise try to
 *    start a second server on a still-busy port.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CommandResult } from '../types.js';
import { readPidFile } from '../lib/process-manager.js';
import { stopHandler } from './stop.js';
import { startHandler } from './start.js';

const HELP_TEXT = `
Usage: openaidy restart [options]

Restart the OpenAidy server: stop (if running) then start.

This is equivalent to running \`openaidy stop\` followed by \`openaidy start\`,
but in a single command with port preservation and a coherent exit code:
  - exit 0 only if BOTH stop and start succeed.
  - exit 1 if either step fails (with the relevant output surfaced).

The port from the previous server PID file is preserved by default. Pass
--port to override (same semantics as \`openaidy start\`).

Options:
  -h, --help          Show this help message
  --port <N>          Listen port (default: preserved from previous PID file;
                      falls back to OPENAIDY_PORT / 3001 if no PID file)
  --server-only       Restart only the server, leave the web frontend alone
                      across the bounce
  --integrated        Build the web bundle first and have the server serve
                      it directly. Implies --server-only (Vite is not
                      spawned). Requires pnpm.

Exit Codes:
  0  Server stopped cleanly (or wasn't running) and a fresh server started
  1  --port / OPENAIDY_PORT invalid, --server-only + --integrated conflict,
     stop failed, or start failed
`;

export async function restartHandler(args: string[]): Promise<CommandResult> {
  // Help flag — short-circuit before any other validation so users always
  // have a way to discover the command's surface.
  if (args.includes('--help') || args.includes('-h')) {
    return { exitCode: 0, output: HELP_TEXT.trim() };
  }

  // Mutual-exclusion check FIRST, before any stop/start runs. The standalone
  // start command also rejects this combination, but we validate here too
  // so a user who passes both flags gets a clear error WITHOUT the server
  // being stopped first.
  const serverOnly = args.includes('--server-only');
  const integrated = args.includes('--integrated');
  if (serverOnly && integrated) {
    return {
      exitCode: 1,
      output:
        'Error: --server-only and --integrated are mutually exclusive. ' +
        'The server was NOT restarted.',
    };
  }

  // If the user did not pass --port, preserve the previous server's port
  // by injecting --port into the args we hand to startHandler. This keeps
  // the origin stable across the bounce — the user's browser tab keeps
  // working, the Vite proxy stays pointed at the same backend, etc.
  let startArgs = args;
  if (!args.includes('--port')) {
    const openaidyHome =
      process.env.OPENAIDY_HOME || resolve(homedir(), '.openaidy');
    const existing = await readPidFile(
      resolve(openaidyHome, 'state/server.pid'),
    );
    if (existing && Number.isInteger(existing.port) && existing.port > 0) {
      startArgs = [...args, '--port', String(existing.port)];
    }
    // No PID file → nothing to preserve → start with whatever args the user
    // gave us (port resolves from env / default in startHandler).
  }

  // Stream the stop output so the user sees what happened, then the start
  // output. We surface both via the returned `output` so callers (tests,
  // the CLI runner) can inspect them as well.
  const stopOut = await stopHandler(args);

  // If stop failed, do NOT start — the old server may still be alive (or
  // the port may still be bound) and a second start would either fail with
  // EADDRINUSE or, worse, leave two servers running. Surface the stop
  // error directly.
  if (stopOut.exitCode !== 0) {
    return {
      exitCode: 1,
      output: stopOut.output,
    };
  }

  const startOut = await startHandler(startArgs);

  return {
    exitCode: startOut.exitCode,
    output: [stopOut.output, startOut.output].filter(Boolean).join('\n'),
  };
}
