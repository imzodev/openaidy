/**
 * systemd integration for `openaidy service` and the lifecycle commands.
 *
 * `openaidy start` on its own spawns a detached server and nothing watches
 * it — if the process dies (e.g. OOM-killed) it stays down until someone
 * notices. Installing the service hands supervision to systemd: the unit runs
 * `openaidy start --foreground`, which exits when the server does, and
 * `Restart=always` brings it back. Once installed, `start`/`stop`/`restart`
 * delegate to systemctl so there is only ever one server.
 *
 * Root installs a system unit (/etc/systemd/system); anyone else gets a user
 * unit (~/.config/systemd/user) plus lingering so it runs without a login.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SERVICE_NAME = 'openaidy';

export type ServiceScope = 'system' | 'user';

export type InstalledService = {
  scope: ServiceScope;
  unitPath: string;
};

export type UnitOptions = {
  scope: ServiceScope;
  /** Absolute path of the node binary to run the CLI with. */
  nodePath: string;
  /** Extra node flags the CLI itself was started with (e.g. a TS loader). */
  nodeArgs?: string[] | undefined;
  /** Absolute path of the CLI entry (cli.mjs). */
  cliPath: string;
  openaidyHome: string;
  /** PATH for the service, so MCP servers find npx/uvx/git. */
  pathEnv: string;
  workingDirectory: string;
  port?: number | undefined;
};

export type SystemctlResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/** Scope the current user installs into: root → system, else user. */
export function defaultScope(): ServiceScope {
  return process.getuid?.() === 0 ? 'system' : 'user';
}

export function unitPath(scope: ServiceScope, home = homedir()): string {
  return scope === 'system'
    ? `/etc/systemd/system/${SERVICE_NAME}.service`
    : join(home, '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
}

/** True when this platform can run the service at all. */
export function systemdAvailable(): boolean {
  return process.platform === 'linux' && existsSync('/run/systemd/system');
}

/**
 * The installed unit this user controls, if any. Checked on every lifecycle
 * command, so it's a cheap existence test rather than a systemctl call.
 */
export function detectInstalledService(): InstalledService | undefined {
  // Escape hatch (and test isolation): ignore any installed unit.
  if (process.env.OPENAIDY_NO_SERVICE === '1') return undefined;
  if (process.platform !== 'linux') return undefined;
  for (const scope of [defaultScope(), 'system'] as const) {
    const path = unitPath(scope);
    if (existsSync(path)) return { scope, unitPath: path };
  }
  return undefined;
}

/** Quote a value for an ExecStart/Environment line. */
function q(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function renderUnit(opts: UnitOptions): string {
  const exec = [
    opts.nodePath,
    ...(opts.nodeArgs ?? []),
    opts.cliPath,
    'start',
    '--foreground',
  ];
  if (opts.port !== undefined) exec.push('--port', String(opts.port));
  return [
    '# Managed by `openaidy service install` — reinstall rather than editing.',
    '[Unit]',
    'Description=OpenAidy server',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${exec.map(q).join(' ')}`,
    `WorkingDirectory=${q(opts.workingDirectory)}`,
    `Environment=${q(`OPENAIDY_HOME=${opts.openaidyHome}`)}`,
    `Environment=${q(`PATH=${opts.pathEnv}`)}`,
    'Restart=always',
    'RestartSec=5',
    // SIGTERM goes to the CLI, which forwards it to the server and waits.
    'KillMode=mixed',
    'TimeoutStopSec=30',
    '',
    '[Install]',
    `WantedBy=${opts.scope === 'system' ? 'multi-user.target' : 'default.target'}`,
    '',
  ].join('\n');
}

export function systemctl(
  scope: ServiceScope,
  args: string[],
): Promise<SystemctlResult> {
  const fullArgs = scope === 'user' ? ['--user', ...args] : args;
  return new Promise((resolve) => {
    execFile('systemctl', fullArgs, (err, stdout, stderr) => {
      const code =
        err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Let a user unit keep running after logout / start at boot. */
export function enableLinger(user: string): Promise<SystemctlResult> {
  return new Promise((resolve) => {
    execFile('loginctl', ['enable-linger', user], (err, stdout, stderr) => {
      resolve({
        code: err ? 1 : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      });
    });
  });
}

/** One-line description of a systemctl failure for CLI output. */
export function describeFailure(result: SystemctlResult): string {
  return (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
}
