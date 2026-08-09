/**
 * Documentation Validation Tests
 *
 * Tests that verify documentation matches implemented commands and paths.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { listCommands } from './commands/index.js';

const docsDir = join(import.meta.dirname, '../../../docs/cli');

describe('Documentation Validation', () => {
  describe('Command Reference', () => {
    const commandRefPath = join(docsDir, 'command-reference.md');
    const commandRef = existsSync(commandRefPath)
      ? readFileSync(commandRefPath, 'utf-8')
      : '';

    it('documents all registered commands', () => {
      const allCommands = listCommands();

      for (const cmd of allCommands) {
        expect(
          commandRef.includes(cmd),
          `Command "${cmd}" should be documented in command-reference.md`,
        ).toBe(true);
      }
    });

    it('documents admin token commands', () => {
      expect(commandRef.includes('admin token show')).toBe(true);
      expect(commandRef.includes('admin token validate')).toBe(true);
      expect(commandRef.includes('admin token path')).toBe(true);
    });

    it('documents devices commands', () => {
      expect(commandRef.includes('devices list')).toBe(true);
      expect(commandRef.includes('devices approve')).toBe(true);
      expect(commandRef.includes('devices deny')).toBe(true);
    });

    it('documents exit codes', () => {
      expect(commandRef.includes('Exit Codes')).toBe(true);
      expect(commandRef.includes('0')).toBe(true); // Success
      expect(commandRef.includes('1')).toBe(true); // Error
    });
  });

  describe('Bootstrap Admin Guide', () => {
    const bootstrapPath = join(docsDir, 'bootstrap-admin.md');
    const bootstrap = existsSync(bootstrapPath)
      ? readFileSync(bootstrapPath, 'utf-8')
      : '';

    it('documents token location', () => {
      expect(
        bootstrap.includes('.openaidy/credentials/bootstrap-admin.json'),
      ).toBe(true);
    });

    it('documents admin token show command', () => {
      expect(bootstrap.includes('admin token show')).toBe(true);
    });

    it('documents token statuses', () => {
      expect(bootstrap.includes('valid')).toBe(true);
      expect(bootstrap.includes('expired')).toBe(true);
      expect(bootstrap.includes('missing')).toBe(true);
    });
  });

  describe('Getting Started Guide', () => {
    const gettingStartedPath = join(docsDir, 'getting-started.md');
    const gettingStarted = existsSync(gettingStartedPath)
      ? readFileSync(gettingStartedPath, 'utf-8')
      : '';

    it('documents repo-local execution', () => {
      expect(gettingStarted.includes('pnpm openaidy')).toBe(true);
    });

    it('documents devices list command', () => {
      expect(gettingStarted.includes('devices list')).toBe(true);
    });

    it('documents devices approve command', () => {
      expect(gettingStarted.includes('devices approve')).toBe(true);
    });

    it('documents troubleshooting section', () => {
      expect(
        gettingStarted.includes('Troubleshooting') ||
          gettingStarted.includes('troubleshooting'),
      ).toBe(true);
    });
  });

  describe('Architecture Guide', () => {
    // Contributor-facing, so it now lives under plans/ with the rest of the
    // dev-facing docs — docsDir (docs/cli) only holds user-facing pages now.
    const archPath = join(
      import.meta.dirname,
      '../../../plans/cli/architecture.md',
    );
    const arch = existsSync(archPath) ? readFileSync(archPath, 'utf-8') : '';

    it('documents package structure', () => {
      expect(arch.includes('@openaidy/cli')).toBe(true);
      expect(arch.includes('@openaidy/control-plane')).toBe(true);
      expect(arch.includes('@openaidy/server')).toBe(true);
    });

    it('documents workflow pattern', () => {
      expect(arch.includes('WorkflowResult') || arch.includes('workflow')).toBe(
        true,
      );
    });

    it('documents command registration', () => {
      expect(
        arch.includes('registerCommand') || arch.includes('register'),
      ).toBe(true);
    });
  });

  describe('Installation Guide', () => {
    const installPath = join(docsDir, 'installation.md');
    const install = existsSync(installPath)
      ? readFileSync(installPath, 'utf-8')
      : '';

    it('documents pnpm installation', () => {
      expect(install.includes('pnpm install')).toBe(true);
    });

    it('documents running via pnpm', () => {
      expect(install.includes('pnpm openaidy')).toBe(true);
    });

    it('documents future global installation', () => {
      expect(install.includes('npm install -g @openaidy/cli')).toBe(true);
    });
  });

  describe('Control Plane Overview', () => {
    // Contributor-facing — moved under plans/control-plane/ with the rest of
    // the dev-facing docs.
    const controlPlanePath = join(
      import.meta.dirname,
      '../../../plans/control-plane/overview.md',
    );
    const controlPlane = existsSync(controlPlanePath)
      ? readFileSync(controlPlanePath, 'utf-8')
      : '';

    it('documents workflows', () => {
      expect(controlPlane.includes('BootstrapAdminWorkflow')).toBe(true);
      expect(controlPlane.includes('PairingWorkflow')).toBe(true);
    });

    it('documents design principles', () => {
      expect(
        controlPlane.includes('Local-First') ||
          controlPlane.includes('local-first'),
      ).toBe(true);
    });
  });
});
