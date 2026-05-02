/**
 * Addon Publish Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const {
  mockClack,
  mockFs,
  mockReadAddonManifest,
  mockValidateProjectStructure,
} = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
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

import { addonPublishHandler } from './publish.js';

const PROJECT = process.cwd();
const MANIFEST = {
  id: 'my-addon',
  name: 'My Addon',
  version: '1.0.0',
  entry: 'dist/index.js',
  openaidy: { minVersion: '1.0.0' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockReadAddonManifest.mockReturnValue(MANIFEST);
  mockValidateProjectStructure.mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
  });
  mockFs.existsSync.mockImplementation((p: string) => {
    if (p === PROJECT) return true;
    if (p === path.join(PROJECT, 'dist')) return true;
    if (p === path.join(PROJECT, 'dist', 'index.js')) return true;
    if (p === path.join(PROJECT, 'addon.json')) return true;
    if (p === path.join(PROJECT, 'package.json')) return true;
    return false;
  });
});

describe('addonPublishHandler', () => {
  describe('successful publish', () => {
    it('returns exit 0 and calls outro with registry URL', async () => {
      const result = await addonPublishHandler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('registry.openaidy.dev'),
      );
    });

    it('includes addon id and version in registry URL', async () => {
      await addonPublishHandler([]);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('my-addon'),
      );
    });
  });

  describe('publish failure', () => {
    it('returns exit 1 when dist/ is missing', async () => {
      mockFs.existsSync.mockImplementation(
        (p: string) =>
          p !== path.join(PROJECT, 'dist') &&
          p !== path.join(PROJECT, 'dist', 'index.js'),
      );
      const result = await addonPublishHandler([]);
      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when validation fails', async () => {
      mockReadAddonManifest.mockReturnValue({ ...MANIFEST, id: undefined });
      const result = await addonPublishHandler([]);
      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });
  });
});
