/**
 * CLI Command Registry Tests
 *
 * Tests for the command registry, help system, and centralized process behavior
 * as specified in issue #135.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const exec = promisify(execFile);

// Path to CLI entrypoint
const cliPath = resolve(__dirname, '../bin/openaidy.ts');

// Read package.json once
const packageJsonPath = resolve(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

/**
 * Helper to run CLI and capture exit code without throwing.
 * Returns stdout, stderr, and the process exit code.
 */
async function runCli(
  args: string[],
  timeout = 10000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await exec('tsx', [cliPath, ...args], { timeout });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
      code: execErr.code ?? 1,
    };
  }
}

describe('CLI Command Registry', () => {
  describe('Root help output', () => {
    it('shows help with no arguments', async () => {
      const { stdout } = await runCli([]);

      expect(stdout).toContain('openaidy');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Command Groups:');
    });

    it('shows help with --help flag', async () => {
      const { stdout } = await runCli(['--help']);

      expect(stdout).toContain('openaidy');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Command Groups:');
    });

    it('shows admin and devices groups', async () => {
      const { stdout } = await runCli(['--help']);

      expect(stdout).toContain('admin');
      expect(stdout).toContain('devices');
      expect(stdout).toContain('Administrative commands');
    });

    it('shows version with --version flag', async () => {
      const { stdout } = await runCli(['--version']);

      expect(stdout).toContain('openaidy');
      expect(stdout).toMatch(/v?\d+\.\d+\.\d+/);
    });
  });

  describe('Command group help', () => {
    it('shows admin group help with "admin --help"', async () => {
      const { stdout } = await runCli(['admin', '--help']);

      expect(stdout).toContain('admin');
      expect(stdout).toContain('Administrative commands');
      expect(stdout).toContain('token');
    });

    it('shows devices group help with "devices --help"', async () => {
      const { stdout } = await runCli(['devices', '--help']);

      expect(stdout).toContain('devices');
      expect(stdout).toContain('Device pairing');
      expect(stdout).toContain('list');
      expect(stdout).toContain('approve');
      expect(stdout).toContain('deny');
    });

    it('shows admin group help with just "admin"', async () => {
      const { stdout } = await runCli(['admin']);

      expect(stdout).toContain('admin');
      expect(stdout).toContain('Commands:');
      expect(stdout).toContain('token');
    });
  });

  describe('Command help output', () => {
    it('shows help for "admin token show --help"', async () => {
      const { stdout } = await runCli(['admin', 'token', 'show', '--help']);

      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('admin token show');
      expect(stdout).toContain('bootstrap-admin token');
    });

    it('shows help for "devices approve --help"', async () => {
      const { stdout } = await runCli(['devices', 'approve', '--help']);

      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('devices approve');
      expect(stdout).toContain('request-id');
    });

    it('shows usage example in help', async () => {
      const { stdout } = await runCli(['admin', 'token', 'show', '--help']);

      expect(stdout).toContain('Examples:');
      expect(stdout).toContain('pnpm openaidy');
    });
  });

  describe('Error handling', () => {
    it('returns non-zero exit code for unknown command', async () => {
      const { code } = await runCli(['unknown-command']);
      expect(code).not.toBe(0);
    });

    it('returns non-zero exit code for unknown subcommand', async () => {
      const { code } = await runCli(['admin', 'unknown']);
      expect(code).not.toBe(0);
    });

    it('returns non-zero exit code for missing required argument', async () => {
      const { code } = await runCli(['devices', 'approve']);
      expect(code).not.toBe(0);
    });

    it('returns non-zero exit code for unknown group', async () => {
      const { code } = await runCli(['foo', 'bar']);
      expect(code).not.toBe(0);
    });
  });

  describe('Command routing', () => {
    it('routes to "admin token show"', async () => {
      // admin token show now calls BootstrapAdminWorkflow.inspectToken();
      // without a token file it exits non-zero but still outputs the header.
      const { stdout, stderr } = await runCli(['admin', 'token', 'show']);

      expect(stdout + stderr).toContain('Bootstrap Admin Token');
    });

    it('routes to "devices list"', async () => {
      // devices list now connects to the WS server; without a running server
      // it exits with a connection/token error - verify the command is routed
      // by checking that the output mentions the token or connection.
      const { stdout, stderr } = await runCli(['devices', 'list']);

      expect(stdout + stderr).toMatch(/token|connect|pending/i);
    });

    it('routes to "admin token path"', async () => {
      const { stdout } = await runCli(['admin', 'token', 'path']);

      expect(stdout).toContain('bootstrap-admin.json');
    });
  });

  describe('Exit codes', () => {
    it('returns exit code 0 for help', async () => {
      const { stdout, code } = await runCli(['--help']);
      expect(stdout).toBeTruthy();
      expect(code).toBe(0);
    });

    it('returns exit code 0 for version', async () => {
      const { stdout, code } = await runCli(['--version']);
      expect(stdout).toBeTruthy();
      expect(code).toBe(0);
    });

    it('returns non-zero exit code for unknown command', async () => {
      const { code } = await runCli(['unknown']);
      expect(code).not.toBe(0);
    });

    it('returns non-zero exit code for missing argument', async () => {
      const { code } = await runCli(['devices', 'approve']);
      expect(code).not.toBe(0);
    });
  });
});

describe('Package structure', () => {
  it('exposes binary as openaidy', () => {
    expect(packageJson.bin).toBeDefined();
    expect(packageJson.bin.openaidy).toBe('./bin/openaidy.ts');
  });

  it('has correct package name', () => {
    expect(packageJson.name).toBe('@openaidy/cli');
  });

  it('exports main entrypoint', () => {
    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports['.']).toBe('./src/index.ts');
  });

  it('has required scripts', () => {
    expect(packageJson.scripts.build).toBeDefined();
    expect(packageJson.scripts.test).toBeDefined();
  });
});

describe('Repo-local invocation', () => {
  it('can be invoked via pnpm openaidy from repo root', async () => {
    const repoRoot = resolve(__dirname, '../../..');
    const { stdout } = await exec('pnpm', ['openaidy', '--help'], {
      cwd: repoRoot,
      timeout: 15000,
    });

    expect(stdout).toContain('openaidy');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('Command Groups:');
  });

  it('can invoke admin token show via pnpm', async () => {
    const repoRoot = resolve(__dirname, '../../..');
    try {
      const { stdout } = await exec(
        'pnpm',
        ['openaidy', 'admin', 'token', 'show'],
        {
          cwd: repoRoot,
          timeout: 15000,
        },
      );
      expect(stdout).toContain('Bootstrap Admin Token');
    } catch (err: unknown) {
      // Command may exit non-zero if token file is missing, but should still output header
      const execErr = err as { stdout?: string; stderr?: string };
      const output = execErr.stdout ?? '';
      expect(output).toContain('Bootstrap Admin Token');
    }
  });
});
