/**
 * Addon Init Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockClack,
  mockFs,
  mockReadAddonManifest,
  mockDetectAddonProject,
  mockValidateProjectStructure,
} = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  mockFs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  mockReadAddonManifest: vi.fn(),
  mockDetectAddonProject: vi.fn(),
  mockValidateProjectStructure: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);
vi.mock('node:fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('../../utils/project.js', () => ({
  detectAddonProject: mockDetectAddonProject,
  readAddonManifest: mockReadAddonManifest,
  validateProjectStructure: mockValidateProjectStructure,
}));

import { addonInitHandler } from './init.js';

const MANIFEST = { id: 'my-addon', name: 'My Addon', version: '1.0.0' };

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockFs.existsSync.mockReturnValue(true);
  mockDetectAddonProject.mockReturnValue(false);
  mockValidateProjectStructure.mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
  });
  mockReadAddonManifest.mockReturnValue(MANIFEST);
  mockFs.readFileSync.mockReturnValue('{}');
});

describe('addonInitHandler', () => {
  it('returns exit 0 and calls outro on success', async () => {
    const result = await addonInitHandler([]);
    expect(result.exitCode).toBe(0);
    expect(mockClack.outro).toHaveBeenCalledWith(
      expect.stringContaining('My Addon'),
    );
  });

  it('returns exit 0 when already initialized (no --force)', async () => {
    mockDetectAddonProject.mockReturnValue(true);
    const result = await addonInitHandler([]);
    expect(result.exitCode).toBe(0);
    expect(mockClack.outro).toHaveBeenCalledWith(
      expect.stringContaining('already an addon'),
    );
  });

  it('reinitializes when --force is passed even if already an addon', async () => {
    mockDetectAddonProject.mockReturnValue(true);
    const result = await addonInitHandler(['--force']);
    expect(result.exitCode).toBe(0);
    expect(mockClack.outro).toHaveBeenCalledWith(
      expect.stringContaining('My Addon'),
    );
  });

  it('returns exit 1 when project directory does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await addonInitHandler([]);
    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalled();
  });

  it('returns exit 1 when project structure is invalid', async () => {
    mockValidateProjectStructure.mockReturnValue({
      valid: false,
      errors: ['Missing required file: addon.json'],
      warnings: [],
    });
    const result = await addonInitHandler([]);
    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalled();
  });
});
