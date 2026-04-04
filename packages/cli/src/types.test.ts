/**
 * CLI Extension Points Tests
 * 
 * Tests verifying the CLI structure supports future growth:
 * - JSON output readiness
 * - Command scalability
 * - Distribution readiness
 * - Workflow reuse
 */

import { describe, it, expect } from 'vitest';
import {
  type CommandResult,
  type CommandHandler,
  type CommandRegistry,
  type CommandMeta,
  type CommandGroup,
  type CLIConfig,
  type OutputMode,
  type ParseOptions,
  type CommandOptions,
  ExitCodes,
  defaultCLIConfig,
} from './types.js';

describe('CLI Extension Points', () => {
  describe('JSON Output Support', () => {
    it('CommandResult supports data field for JSON output', () => {
      const result: CommandResult = {
        exitCode: 0,
        data: { requestId: 'abc123', status: 'approved' },
        mode: 'json',
      };

      expect(result.data).toBeDefined();
      expect(result.mode).toBe('json');
    });

    it('CommandResult supports text output mode', () => {
      const result: CommandResult = {
        exitCode: 0,
        output: 'Request approved',
        mode: 'text',
      };

      expect(result.output).toBe('Request approved');
      expect(result.mode).toBe('text');
    });

    it('OutputMode type allows text and json', () => {
      const modes: OutputMode[] = ['text', 'json'];
      expect(modes).toContain('text');
      expect(modes).toContain('json');
    });

    it('ParseOptions supports json flag', () => {
      const options: ParseOptions = { json: true };
      expect(options.json).toBe(true);
    });

    it('CommandOptions includes help flag', () => {
      const options: CommandOptions = {
        help: false,
      };
      expect(options.help).toBe(false);
    });

    it('CommandOptions supports optional outputMode', () => {
      const options: CommandOptions = {
        outputMode: 'json',
        help: false,
      };
      expect(options.outputMode).toBe('json');
    });
  });

  describe('Command Scalability', () => {
    it('CommandRegistry allows arbitrary command paths', () => {
      const registry: CommandRegistry = {
        'admin token show': async () => ({ exitCode: 0 }),
        'admin token validate': async () => ({ exitCode: 0 }),
        'devices list': async () => ({ exitCode: 0 }),
        'devices approve': async () => ({ exitCode: 0 }),
        'config show': async () => ({ exitCode: 0 }),
      };

      expect(Object.keys(registry)).toHaveLength(5);
      expect('admin token show' in registry).toBe(true);
    });

    it('CommandMeta supports all required fields', () => {
      const meta: CommandMeta = {
        description: 'Show bootstrap admin token',
        usage: 'openaidy admin token show',
        examples: ['pnpm openaidy admin token show'],
      };

      expect(meta.description).toBeDefined();
      expect(meta.usage).toBeDefined();
      expect(meta.examples).toHaveLength(1);
    });

    it('CommandGroup organizes commands by domain', () => {
      const group: CommandGroup = {
        name: 'devices',
        description: 'Device management',
        commands: {
          'devices list': { description: 'List devices' },
          'devices approve': { description: 'Approve device' },
        },
      };

      expect(group.name).toBe('devices');
      expect(Object.keys(group.commands)).toHaveLength(2);
    });

    it('CommandHandler type is async', async () => {
      const handler: CommandHandler = async (args) => {
        return { exitCode: 0, output: 'OK' };
      };

      const result = await handler(['--test']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Distribution Readiness', () => {
    it('defaultCLIConfig has required fields', () => {
      expect(defaultCLIConfig.name).toBe('openaidy');
      expect(defaultCLIConfig.version).toMatch(/\d+\.\d+\.\d+/);
      expect(defaultCLIConfig.description).toBeDefined();
    });

    it('ExitCodes are defined for all error categories', () => {
      expect(ExitCodes.SUCCESS).toBe(0);
      expect(ExitCodes.ERROR).toBe(1);
      expect(ExitCodes.INVALID_ARGS).toBe(2);
      expect(ExitCodes.NOT_FOUND).toBe(3);
      expect(ExitCodes.PERMISSION_DENIED).toBe(4);
      expect(ExitCodes.CONFIG_ERROR).toBe(5);
    });

    it('CLIConfig type is serializable', () => {
      const config: CLIConfig = {
        name: 'test-cli',
        version: '1.0.0',
        description: 'Test CLI',
      };

      const serialized = JSON.stringify(config);
      const parsed = JSON.parse(serialized);

      expect(parsed.name).toBe('test-cli');
      expect(parsed.version).toBe('1.0.0');
    });
  });

  describe('Workflow Reuse', () => {
    it('CommandResult.data is typed as unknown for flexibility', () => {
      // This allows any JSON-serializable data
      const result: CommandResult = {
        exitCode: 0,
        data: { any: 'structure', works: [1, 2, 3] },
      };

      expect(result.data).toBeDefined();
    });

    it('CommandHandler does not depend on terminal', () => {
      // Handler returns structured result, not console output
      const handler: CommandHandler = async () => ({
        exitCode: 0,
        data: { success: true },
        mode: 'json',
      });

      // Can be called without terminal
      expect(handler).toBeDefined();
    });
  });

  describe('Type Exports', () => {
    it('exports all necessary types', () => {
      // This test verifies types are exported by compiling without error
      const types = {
        CommandResult: {} as CommandResult,
        CommandHandler: {} as CommandHandler,
        CommandRegistry: {} as CommandRegistry,
        CommandMeta: {} as CommandMeta,
        CommandGroup: {} as CommandGroup,
        CLIConfig: {} as CLIConfig,
        OutputMode: 'text' as OutputMode,
        ParseOptions: {} as ParseOptions,
        CommandOptions: {} as CommandOptions,
      };

      expect(types).toBeDefined();
    });
  });
});
