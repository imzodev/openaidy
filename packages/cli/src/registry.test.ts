/**
 * CLI Command Registry Tests
 * 
 * Tests for the command registry, help system, and centralized process behavior
 * as specified in issue #135.
 */

import { describe, expect, it, beforeEach } from 'vitest';
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

describe('CLI Command Registry', () => {
  describe('Root help output', () => {
    it('shows help with no arguments', async () => {
      const { stdout } = await exec('tsx', [cliPath], { timeout: 10000 });
      
      expect(stdout).toContain('openaidy');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Command Groups:');
    });

    it('shows help with --help flag', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('openaidy');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Command Groups:');
    });

    it('shows admin and devices groups', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('admin');
      expect(stdout).toContain('devices');
      expect(stdout).toContain('Administrative commands');
    });

    it('shows version with --version flag', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--version'], { timeout: 10000 });
      
      expect(stdout).toContain('openaidy');
      expect(stdout).toMatch(/v?\d+\.\d+\.\d+/);
    });
  });

  describe('Command group help', () => {
    it('shows admin group help with "admin --help"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin', '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('admin');
      expect(stdout).toContain('Administrative commands');
      expect(stdout).toContain('token');
    });

    it('shows devices group help with "devices --help"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'devices', '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('devices');
      expect(stdout).toContain('Device pairing');
      expect(stdout).toContain('list');
      expect(stdout).toContain('approve');
      expect(stdout).toContain('deny');
    });

    it('shows admin group help with just "admin"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin'], { timeout: 10000 });
      
      expect(stdout).toContain('admin');
      expect(stdout).toContain('Commands:');
      expect(stdout).toContain('token');
    });
  });

  describe('Command help output', () => {
    it('shows help for "admin token show --help"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin', 'token', 'show', '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('admin token show');
      expect(stdout).toContain('bootstrap-admin token');
    });

    it('shows help for "devices approve --help"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'devices', 'approve', '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('devices approve');
      expect(stdout).toContain('request-id');
    });

    it('shows usage example in help', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin', 'token', 'show', '--help'], { timeout: 10000 });
      
      expect(stdout).toContain('Examples:');
      expect(stdout).toContain('pnpm openaidy');
    });
  });

  describe('Error handling', () => {
    it('returns non-zero exit code for unknown command', async () => {
      try {
        await exec('tsx', [cliPath, 'unknown-command'], { timeout: 10000 });
        expect.fail('Expected non-zero exit code');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
    });

    it('returns non-zero exit code for unknown subcommand', async () => {
      try {
        await exec('tsx', [cliPath, 'admin', 'unknown'], { timeout: 10000 });
        expect.fail('Expected non-zero exit code');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
    });

    it('returns non-zero exit code for missing required argument', async () => {
      try {
        await exec('tsx', [cliPath, 'devices', 'approve'], { timeout: 10000 });
        expect.fail('Expected non-zero exit code');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
    });

    it('returns non-zero exit code for unknown group', async () => {
      try {
        await exec('tsx', [cliPath, 'foo', 'bar'], { timeout: 10000 });
        expect.fail('Expected non-zero exit code');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
    });
  });

  describe('Command routing', () => {
    it('routes to "admin token show"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin', 'token', 'show'], { timeout: 10000 });
      
      expect(stdout).toContain('Bootstrap Admin Token');
    });

    it('routes to "devices list"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'devices', 'list'], { timeout: 10000 });
      
      expect(stdout).toContain('pending');
    });

    it('routes to "admin token path"', async () => {
      const { stdout } = await exec('tsx', [cliPath, 'admin', 'token', 'path'], { timeout: 10000 });
      
      expect(stdout).toContain('bootstrap-admin.json');
    });
  });

  describe('Exit codes', () => {
    it('returns exit code 0 for help', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--help'], { timeout: 10000 });
      expect(stdout).toBeTruthy();
    });

    it('returns exit code 0 for version', async () => {
      const { stdout } = await exec('tsx', [cliPath, '--version'], { timeout: 10000 });
      expect(stdout).toBeTruthy();
    });

    it('returns non-zero exit code for unknown command', async () => {
      try {
        await exec('tsx', [cliPath, 'unknown'], { timeout: 10000 });
        expect.fail('Expected non-zero exit code');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
    });

    it('returns non-zero exit code for missing argument', async () => {
      try {
        await exec('tsx', [cliPath, 'devices', 'approve'], { timeout: 10000 });
        expect.fail('Expected non-zero exit code');
      } catch (error: any) {
        expect(error.code).not.toBe(0);
      }
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
    const { stdout } = await exec('pnpm', ['openaidy', 'admin', 'token', 'show'], {
      cwd: repoRoot,
      timeout: 15000,
    });

    expect(stdout).toContain('Bootstrap Admin Token');
  });
});
