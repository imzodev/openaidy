/**
 * Addon Create Handler Tests
 *
 * Tests the addonCreateHandler argument parsing and Clack output.
 * The underlying createAddon library is covered by the existing create.test.ts
 * (commands/create.test.ts), so here we focus on invalid args and the
 * handler's response to the name-required guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClack, mockFs } = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    intro: vi.fn(),
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  mockFs: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => mockClack);
vi.mock('node:fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('../../utils/project.js', () => ({
  slugify: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
  resolveAddonsDir: () => '/addons',
  readAddonManifest: vi.fn().mockReturnValue(null),
  detectAddonProject: vi.fn().mockReturnValue(false),
  validateProjectStructure: vi
    .fn()
    .mockReturnValue({ valid: true, errors: [], warnings: [] }),
}));
vi.mock('./install.js', () => ({
  installAddon: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));
vi.mock('./build.js', () => ({
  buildAddon: vi
    .fn()
    .mockResolvedValue({
      success: true,
      message: 'ok',
      outputPath: '/dist/index.js',
    }),
}));

import { addonCreateHandler } from './create.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockFs.existsSync.mockReturnValue(false);
  mockFs.readdirSync.mockReturnValue([]);
  mockFs.readFileSync.mockReturnValue('{}');
});

describe('addonCreateHandler', () => {
  describe('argument validation', () => {
    it('returns exit 1 when no name given', async () => {
      const result = await addonCreateHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('Addon name is required');
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when name starts with a flag', async () => {
      const result = await addonCreateHandler(['--template', 'basic']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('Addon name is required');
    });
  });

  describe('successful creation', () => {
    it('calls p.intro with addon name', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await addonCreateHandler(['my-addon']);
      expect(mockClack.intro).toHaveBeenCalledWith('Create Addon: my-addon');
    });
  });
});
