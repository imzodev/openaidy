/**
 * Addon Build Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const {
  mockClack,
  mockFs,
  mockReadAddonManifest,
  mockResolveAddonProject,
  mockListAddonProjects,
} = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  mockFs: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
  },
  mockReadAddonManifest: vi.fn(),
  mockResolveAddonProject: vi.fn(),
  mockListAddonProjects: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);
vi.mock('node:fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('../../utils/project.js', () => ({
  resolveAddonProject: mockResolveAddonProject,
  listAddonProjects: mockListAddonProjects,
  readAddonManifest: mockReadAddonManifest,
}));

import { addonBuildHandler } from './build.js';

const ADDON_PATH = '/addons/my-addon';
const ADDON = { name: 'my-addon', path: ADDON_PATH };
const MANIFEST = { id: 'my-addon', name: 'My Addon', version: '1.0.0' };

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockResolveAddonProject.mockReturnValue(ADDON);
  mockReadAddonManifest.mockReturnValue(MANIFEST);
  mockFs.existsSync.mockImplementation((p: string) => {
    if (p === ADDON_PATH) return true;
    if (p === path.join(ADDON_PATH, 'src')) return true;
    if (p === path.join(ADDON_PATH, 'src', 'index.ts')) return true;
    if (p === path.join(ADDON_PATH, 'dist')) return true;
    return false;
  });
  mockFs.readFileSync.mockReturnValue('export default {}');
});

describe('addonBuildHandler', () => {
  describe('project resolution errors', () => {
    it('returns exit 1 when no addons found', async () => {
      mockResolveAddonProject.mockReturnValue(null);
      mockListAddonProjects.mockReturnValue([]);

      const result = await addonBuildHandler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('No addons found');
    });

    it('returns exit 1 with hint when multiple addons exist', async () => {
      mockResolveAddonProject.mockReturnValue(null);
      mockListAddonProjects.mockReturnValue([
        { name: 'a', path: '/a' },
        { name: 'b', path: '/b' },
      ]);

      const result = await addonBuildHandler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Multiple addons found');
    });
  });

  describe('successful build', () => {
    it('returns exit 0 and calls outro on success', async () => {
      const result = await addonBuildHandler([]);

      expect(result.exitCode).toBe(0);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('My Addon'),
      );
    });

    it('includes output path in outro', async () => {
      await addonBuildHandler([]);

      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('dist/index.js'),
      );
    });
  });

  describe('build failure', () => {
    it('returns exit 1 when src/index.ts is missing', async () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === path.join(ADDON_PATH, 'src', 'index.ts')) return false;
        return true;
      });

      const result = await addonBuildHandler([]);

      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when addon.json is missing', async () => {
      mockReadAddonManifest.mockReturnValue(null);

      const result = await addonBuildHandler([]);

      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });
  });
});
