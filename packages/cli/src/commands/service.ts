/**
 * openaidy service — run OpenAidy under systemd so it restarts on its own.
 *
 *   openaidy service install [--port <N>]   write + enable + start the unit
 *   openaidy service uninstall              stop + disable + remove it
 *   openaidy service status                 systemctl status
 *
 * Linux only. See lib/service-manager.ts for the unit and scope rules.
 */

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir, userInfo } from 'node:os';
import type { CommandResult } from '../types.js';
import {
  SERVICE_NAME,
  defaultScope,
  describeFailure,
  detectInstalledService,
  enableLinger,
  renderUnit,
  systemctl,
  systemdAvailable,
  unitPath,
} from '../lib/service-manager.js';
import { isProcessAlive, readPidFile } from '../lib/process-manager.js';
import { pollHealth, resolveStartPort } from './start.js';
import { stopHandler } from './stop.js';

const INSTALL_HELP = `
Usage: openaidy service install [--port <N>]

Install OpenAidy as a systemd service that starts at boot and restarts
automatically if the server crashes (e.g. when it runs out of memory).

As root this installs a system unit (/etc/systemd/system/openaidy.service);
otherwise a user unit (~/.config/systemd/user/openaidy.service) with
lingering enabled so it keeps running after you log out.

A server already started with \`openaidy start\` is stopped first and
handed over to the service. Afterwards \`openaidy start|stop|restart\`
control the service through systemctl. Re-run to update the unit.

Options:
  -h, --help          Show this help message
  --port <N>          Listen port (default: OPENAIDY_PORT or 3001)

Exit Codes:
  0  Service installed, enabled and healthy
  1  Not Linux/systemd, systemctl failed, or the server didn't come up
`;

const UNINSTALL_HELP = `
Usage: openaidy service uninstall

Stop and disable the OpenAidy systemd service and remove its unit file.
Your data in OPENAIDY_HOME is not touched; run \`openaidy start\` to go
back to an unmanaged server.

Exit Codes:
  0  Service removed (or was not installed)
  1  systemctl failed
`;

const STATUS_HELP = `
Usage: openaidy service status

Show whether the OpenAidy systemd service is installed, enabled and
running (\`systemctl status openaidy\`).

Exit Codes:
  0  Status reported (installed or not)
`;

function wantsHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function notSupported(): CommandResult {
  return {
    exitCode: 1,
    output:
      'Error: `openaidy service` needs Linux with systemd. On other systems keep ' +
      "using `openaidy start`, or run it under your platform's service manager.",
  };
}

export async function serviceInstallHandler(
  args: string[],
): Promise<CommandResult> {
  if (wantsHelp(args)) return { exitCode: 0, output: INSTALL_HELP.trim() };
  if (!systemdAvailable()) return notSupported();

  const portResult = resolveStartPort(args, process.env);
  if (!portResult.ok) return { exitCode: 1, output: portResult.error };
  const portFlag = args.includes('--port') ? portResult.port : undefined;

  const scope = defaultScope();
  const path = unitPath(scope);
  const openaidyHome =
    process.env.OPENAIDY_HOME || resolve(homedir(), '.openaidy');
  const lines: string[] = [];

  // Hand an unmanaged server over to systemd so the two never fight over the port.
  if (!detectInstalledService()) {
    const running = await readPidFile(
      resolve(openaidyHome, 'state/server.pid'),
    );
    if (running && isProcessAlive(running.pid)) {
      const stopped = await stopHandler([]);
      if (stopped.exitCode !== 0) {
        return {
          exitCode: 1,
          output: `Error: couldn't stop the running server before installing the service.\n${stopped.output}`,
        };
      }
      lines.push(
        'Stopped the running server; the service takes over from here.',
      );
    }
  }

  const cliPath = process.argv[1];
  if (!cliPath) {
    return { exitCode: 1, output: 'Error: could not determine the CLI path.' };
  }
  const unit = renderUnit({
    scope,
    nodePath: process.execPath,
    nodeArgs: process.execArgv,
    cliPath,
    openaidyHome,
    pathEnv: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    workingDirectory: homedir(),
    port: portFlag,
  });

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, unit, 'utf-8');
  } catch (err) {
    return {
      exitCode: 1,
      output: `Error: couldn't write ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  lines.push(`Wrote ${path}`);

  if (scope === 'user') {
    const linger = await enableLinger(userInfo().username);
    if (linger.code !== 0) {
      lines.push(
        'Warning: could not enable lingering, so the service stops when you log out.',
        `  Fix: sudo loginctl enable-linger ${userInfo().username}`,
      );
    }
  }

  for (const step of [
    ['daemon-reload'],
    ['enable', SERVICE_NAME],
    ['restart', SERVICE_NAME],
  ]) {
    const result = await systemctl(scope, step);
    if (result.code !== 0) {
      return {
        exitCode: 1,
        output: [
          ...lines,
          `Error: systemctl ${step.join(' ')} failed: ${describeFailure(result)}`,
        ].join('\n'),
      };
    }
  }

  const healthy = await pollHealth(portResult.port);
  const statusCmd = scope === 'user' ? 'systemctl --user' : 'systemctl';
  return {
    exitCode: healthy ? 0 : 1,
    output: [
      ...lines,
      healthy
        ? `OpenAidy is running as ${SERVICE_NAME}.service on http://localhost:${portResult.port} and will restart automatically.`
        : `Error: ${SERVICE_NAME}.service started but /health did not respond within 30 seconds.`,
      `  Status: ${statusCmd} status ${SERVICE_NAME}`,
      `  Logs:   ${resolve(openaidyHome, 'logs', 'server.log')}`,
    ].join('\n'),
  };
}

export async function serviceUninstallHandler(
  args: string[],
): Promise<CommandResult> {
  if (wantsHelp(args)) return { exitCode: 0, output: UNINSTALL_HELP.trim() };
  const service = detectInstalledService();
  if (!service) {
    return { exitCode: 0, output: 'The OpenAidy service is not installed.' };
  }
  const disabled = await systemctl(service.scope, [
    'disable',
    '--now',
    SERVICE_NAME,
  ]);
  if (disabled.code !== 0) {
    return {
      exitCode: 1,
      output: `Error: systemctl disable --now ${SERVICE_NAME} failed: ${describeFailure(disabled)}`,
    };
  }
  await unlink(service.unitPath).catch(() => {});
  await systemctl(service.scope, ['daemon-reload']);
  return {
    exitCode: 0,
    output: `Removed ${service.unitPath}. The server is stopped; run \`openaidy start\` to start it unmanaged.`,
  };
}

export async function serviceStatusHandler(
  args: string[],
): Promise<CommandResult> {
  if (wantsHelp(args)) return { exitCode: 0, output: STATUS_HELP.trim() };
  const service = detectInstalledService();
  if (!service) {
    return {
      exitCode: 0,
      output: systemdAvailable()
        ? 'The OpenAidy service is not installed. Run `openaidy service install` to have systemd keep the server running.'
        : 'The OpenAidy service is not available on this system (needs Linux with systemd).',
    };
  }
  const status = await systemctl(service.scope, [
    'status',
    SERVICE_NAME,
    '--no-pager',
    '--lines=0',
  ]);
  // `systemctl status` exits 3 for an inactive unit — still a valid report.
  return {
    exitCode: 0,
    output: [`Unit: ${service.unitPath}`, status.stdout.trim()].join('\n'),
  };
}
