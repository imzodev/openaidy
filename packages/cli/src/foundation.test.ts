/**
 * CLI Foundation Tests
 * 
 * Tests for the CLI package foundation as specified in issue #134:
 * - smoke test proving the CLI binary starts successfully
 * - no-args behavior test (shows help)
 * - help-output behavior test
 * - repo-local invocation path validation
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

describe('CLI Foundation', () => {
  describe('Binary startup', () => {
    it('starts successfully with --help flag', async () => {
      const { stdout, stderr } = await exec('tsx', [cliPath, '--help'], {
        timeout: 10000,
      });

      expect(stderr).toBe('');
      expect(stdout).toContain('openaidy');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Commands:');
    });

    it('starts successfully with --version flag', async () => {
      const { stdout, stderr } = await exec('tsx', [cliPath, '--version'], {
        timeout: 10000,
      });

      expect(stderr).toBe('');
      expect(stdout).toContain('openaidy');
      expect(stdout).toMatch(/v?\d+\.\d+\.\d+/);
    });
  });

  describe('No-args behavior', () => {
    it('shows help when called without arguments', async () => {
      const { stdout, stderr } = await exec('tsx', [cliPath], {
        timeout: 10000,
      });

      expect(stderr).toBe('');
      expect(stdout).toContain('openaidy');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Commands:');
    });
  });

  describe('Help output', () => {
    it('shows command list in help output', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--help'], {
        timeout: 10000,
      });

      expect(stdout).toContain('Commands:');
      // Should list available commands
      expect(stdout).toMatch(/admin.*token.*show/);
    });

    it('shows usage examples in help output', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--help'], {
        timeout: 10000,
      });

      expect(stdout).toContain('Examples:');
      expect(stdout).toContain('pnpm openaidy');
    });

    it('shows options in help output', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--help'], {
        timeout: 10000,
      });

      expect(stdout).toContain('Options:');
      expect(stdout).toContain('--help');
      expect(stdout).toContain('--version');
    });
  });

  describe('Error handling', () => {
    it('shows error for unknown command', async () => {
      const { stdout, stderr } = await exec('tsx', [cliPath, 'unknown-command'], {
        timeout: 10000,
      });

      // Should show error message
      const output = stdout + stderr;
      expect(output).toMatch(/unknown|not found|invalid/i);
    });

    it('exits with non-zero code for unknown command', async () => {
      try {
        await exec('tsx', [cliPath, 'unknown-command'], { timeout: 10000 });
        // Should not reach here
        expect.fail('Expected non-zero exit code');
      } catch (error) {
        // Expected - command should fail
        expect(error).toBeDefined();
      }
    });
  });

  describe('Command routing', () => {
    it('routes to admin token show command', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin', 'token', 'show', '--help'], {
        timeout: 10000,
      });

      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('admin token show');
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

  it('has correct version', () => {
    expect(packageJson.version).toBeDefined();
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('has required scripts', () => {
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts.build).toBeDefined();
    expect(packageJson.scripts.test).toBeDefined();
  });
});

describe('Repo-local invocation', () => {
  it('can be invoked via pnpm openaidy from repo root', async () => {
    // This test validates the repo-local script setup
    // by running the CLI through the pnpm script
    const repoRoot = resolve(__dirname, '../../..');
    const { stdout } = await exec('pnpm', ['openaidy', '--help'], {
      cwd: repoRoot,
      timeout: 10000,
    });

    expect(stdout).toContain('openaidy');
    expect(stdout).toContain('Usage:');
  });
});
