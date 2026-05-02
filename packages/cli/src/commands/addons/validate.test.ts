/**
 * Addon Validate Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockClack,
  mockFs,
  mockReadAddonManifest,
  mockValidateProjectStructure,
} = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn(), warn: vi.fn() },
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  mockFs: { existsSync: vi.fn() },
  mockReadAddonManifest: vi.fn(),
  mockValidateProjectStructure: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);
vi.mock('node:fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('../../utils/project.js', () => ({
  readAddonManifest: mockReadAddonManifest,
  validateProjectStructure: mockValidateProjectStructure,
}));
vi.mock('../../utils/validation.js', () => ({
  validateAddonId: () => true,
  validateAddonName: () => true,
  validateVersion: () => true,
}));

import { addonValidateHandler } from './validate.js';

const MANIFEST = {
  id: 'my-addon',
  name: 'My Addon',
  version: '1.0.0',
  openaidy: { minVersion: '1.0.0' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockFs.existsSync.mockReturnValue(true);
  mockReadAddonManifest.mockReturnValue(MANIFEST);
  mockValidateProjectStructure.mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
  });
});

describe('addonValidateHandler', () => {
  describe('passing validation', () => {
    it('returns exit 0 and calls outro on valid addon', async () => {
      const result = await addonValidateHandler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.outro).toHaveBeenCalledWith('Addon validation passed');
    });

    it('treats warnings as errors with --strict', async () => {
      mockReadAddonManifest.mockReturnValue({
        ...MANIFEST,
        description: undefined,
      });
      const result = await addonValidateHandler(['--strict']);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('failing validation', () => {
    it('returns exit 1 when addon.json is missing', async () => {
      mockReadAddonManifest.mockReturnValue(null);
      const result = await addonValidateHandler([]);
      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when project directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = await addonValidateHandler([]);
      expect(result.exitCode).toBe(1);
    });

    it('logs errors and warnings separately', async () => {
      mockValidateProjectStructure.mockReturnValue({
        valid: false,
        errors: ['Missing src/index.ts'],
        warnings: ['README.md missing'],
      });
      await addonValidateHandler([]);
      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Missing src/index.ts'),
      );
      expect(mockClack.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('README.md missing'),
      );
    });

    it('does not call log.warn when there are only errors and no warnings', async () => {
      mockReadAddonManifest.mockReturnValue({
        id: undefined,
        name: 'My Addon',
        version: '1.0.0',
        description: 'A test addon',
        openaidy: { minVersion: '1.0.0' },
      });
      await addonValidateHandler([]);
      expect(mockClack.log.error).toHaveBeenCalled();
      expect(mockClack.log.warn).not.toHaveBeenCalled();
    });
  });
});
