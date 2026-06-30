/**
 * CLI Error Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createCLIError,
  formatCLIError,
  errorToResult,
  cliError,
  argMissing,
  unknownCommand,
  unknownSubcommand,
  requestNotFound,
  serviceUnavailable,
  mapWorkflowError,
  type CLIErrorCategory,
} from './errors.js';

describe('CLI Error Model', () => {
  describe('createCLIError', () => {
    it('creates error with category and default message', () => {
      const error = createCLIError('REQUEST_NOT_FOUND');

      expect(error.category).toBe('REQUEST_NOT_FOUND');
      expect(error.message).toBe('Pairing request not found');
      expect(error.exitCode).toBe(1);
    });

    it('creates error with custom message', () => {
      const error = createCLIError(
        'REQUEST_NOT_FOUND',
        'Request abc123 not found',
      );

      expect(error.category).toBe('REQUEST_NOT_FOUND');
      expect(error.message).toBe('Request abc123 not found');
      expect(error.exitCode).toBe(1);
    });

    it('creates error with details', () => {
      const error = createCLIError('REQUEST_NOT_FOUND', 'Request not found', {
        requestId: 'abc123',
      });

      expect(error.details).toEqual({ requestId: 'abc123' });
    });

    it('maps categories to correct exit codes', () => {
      const tests: Array<{
        category: CLIErrorCategory;
        expectedExitCode: number;
      }> = [
        { category: 'REQUEST_NOT_FOUND', expectedExitCode: 1 },
        { category: 'ARGUMENT_MISSING', expectedExitCode: 2 },
        { category: 'COMMAND_UNKNOWN', expectedExitCode: 2 },
        { category: 'PERMISSION_DENIED', expectedExitCode: 4 },
        { category: 'CONFIG_MISSING', expectedExitCode: 5 },
        { category: 'BOOTSTRAP_DISABLED', expectedExitCode: 1 },
      ];

      for (const { category, expectedExitCode } of tests) {
        const error = createCLIError(category);
        expect(error.exitCode).toBe(expectedExitCode);
      }
    });
  });

  describe('formatCLIError', () => {
    it('formats basic error message', () => {
      const error = createCLIError('REQUEST_NOT_FOUND');
      const formatted = formatCLIError(error);

      expect(formatted).toContain('Error:');
      expect(formatted).toContain('Pairing request not found');
    });

    it('includes hint for argument missing with usage', () => {
      const error = createCLIError('ARGUMENT_MISSING', 'Missing request-id', {
        usage: 'openaidy devices approve <request-id>',
      });
      const formatted = formatCLIError(error);

      expect(formatted).toContain('Usage:');
      expect(formatted).toContain('openaidy devices approve');
    });

    it('includes hint for unknown command with suggestion', () => {
      const error = createCLIError('COMMAND_UNKNOWN', 'Unknown command', {
        suggestion: 'devices list',
      });
      const formatted = formatCLIError(error);

      expect(formatted).toContain('Did you mean');
      expect(formatted).toContain('devices list');
    });

    it('includes hint for missing bootstrap token', () => {
      const error = createCLIError('BOOTSTRAP_TOKEN_MISSING', undefined, {
        showHint: true,
      });
      const formatted = formatCLIError(error);

      expect(formatted).toContain('Run:');
      expect(formatted).toContain('openaidy admin token create');
    });
  });

  describe('errorToResult', () => {
    it('converts error to CommandResult', () => {
      const error = createCLIError(
        'REQUEST_NOT_FOUND',
        'Request abc123 not found',
      );
      const result = errorToResult(error);

      expect(result.exitCode).toBe(1);
      expect(result.error).toBeDefined();
      expect(result.output).toBeUndefined();
    });
  });

  describe('convenience functions', () => {
    describe('cliError', () => {
      it('creates and formats error in one step', () => {
        const result = cliError('REQUEST_NOT_FOUND', 'Request not found');

        expect(result.exitCode).toBe(1);
        expect(result.error).toContain('Error:');
      });
    });

    describe('argMissing', () => {
      it('creates argument missing error', () => {
        const result = argMissing(
          'request-id',
          'openaidy devices approve <request-id>',
        );

        expect(result.exitCode).toBe(2);
        expect(result.error).toContain('Missing required argument');
        expect(result.error).toContain('request-id');
        expect(result.error).toContain('Usage:');
      });
    });

    describe('unknownCommand', () => {
      it('creates unknown command error', () => {
        const result = unknownCommand('foo', 'devices');

        expect(result.exitCode).toBe(2);
        expect(result.error).toContain('Unknown command');
        expect(result.error).toContain('foo');
        expect(result.error).toContain('Did you mean: devices');
      });
    });

    describe('unknownSubcommand', () => {
      it('creates unknown subcommand error', () => {
        const result = unknownSubcommand('devices', 'foo');

        expect(result.exitCode).toBe(2);
        expect(result.error).toContain('Unknown subcommand');
        expect(result.error).toContain('devices foo');
      });
    });

    describe('requestNotFound', () => {
      it('creates request not found error', () => {
        const result = requestNotFound('abc123');

        expect(result.exitCode).toBe(1);
        expect(result.error).toContain('not found');
        expect(result.error).toContain('abc123');
      });
    });

    describe('serviceUnavailable', () => {
      it('creates service unavailable error', () => {
        const result = serviceUnavailable();

        expect(result.exitCode).toBe(1);
        expect(result.error).toContain('pairing service');
      });
    });
  });

  describe('mapWorkflowError', () => {
    it('maps bootstrap errors', () => {
      const tests = [
        { code: 'BOOTSTRAP_ADMIN_DISABLED', expected: 'BOOTSTRAP_DISABLED' },
        {
          code: 'BOOTSTRAP_ADMIN_TOKEN_MISSING',
          expected: 'BOOTSTRAP_TOKEN_MISSING',
        },
        {
          code: 'BOOTSTRAP_ADMIN_TOKEN_MALFORMED',
          expected: 'BOOTSTRAP_TOKEN_MALFORMED',
        },
        {
          code: 'BOOTSTRAP_ADMIN_TOKEN_INVALID',
          expected: 'BOOTSTRAP_TOKEN_INVALID',
        },
        {
          code: 'BOOTSTRAP_ADMIN_TOKEN_EXPIRED',
          expected: 'BOOTSTRAP_TOKEN_EXPIRED',
        },
      ];

      for (const { code, expected } of tests) {
        const error = mapWorkflowError(code);
        expect(error.category).toBe(expected);
      }
    });

    it('maps pairing errors', () => {
      const tests = [
        { code: 'PAIRING_REQUEST_NOT_FOUND', expected: 'REQUEST_NOT_FOUND' },
        { code: 'PAIRING_REQUEST_EXPIRED', expected: 'REQUEST_EXPIRED' },
        {
          code: 'PAIRING_REQUEST_ALREADY_PROCESSED',
          expected: 'REQUEST_NOT_PENDING',
        },
      ];

      for (const { code, expected } of tests) {
        const error = mapWorkflowError(code);
        expect(error.category).toBe(expected);
      }
    });

    it('maps general errors', () => {
      const tests = [
        { code: 'INTERNAL_ERROR', expected: 'INTERNAL_ERROR' },
        { code: 'INVALID_INPUT', expected: 'ARGUMENT_INVALID' },
      ];

      for (const { code, expected } of tests) {
        const error = mapWorkflowError(code);
        expect(error.category).toBe(expected);
      }
    });

    it('falls back to INTERNAL_ERROR for unknown codes', () => {
      const error = mapWorkflowError('UNKNOWN_CODE');
      expect(error.category).toBe('INTERNAL_ERROR');
    });

    it('preserves custom message', () => {
      const error = mapWorkflowError(
        'PAIRING_REQUEST_NOT_FOUND',
        'Custom message',
      );
      expect(error.message).toBe('Custom message');
    });
  });
});
