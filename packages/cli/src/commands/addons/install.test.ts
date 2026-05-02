/**
 * Addon Install Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const {
  mockClack,
  mockFs,
  mockReadFile,
  mockReadAddonManifest,
  mockResolveAddonProject,
  mockListAddonProjects,
  mockResolveCLIConfig,
} = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  mockFs: { existsSync: vi.fn() },
  mockReadFile: vi.fn(),
  mockReadAddonManifest: vi.fn(),
  mockResolveAddonProject: vi.fn(),
  mockListAddonProjects: vi.fn(),
  mockResolveCLIConfig: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);
vi.mock('node:fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));
vi.mock('../../utils/project.js', () => ({
  resolveAddonProject: mockResolveAddonProject,
  listAddonProjects: mockListAddonProjects,
  readAddonManifest: mockReadAddonManifest,
}));
vi.mock('../../lib/config.js', () => ({
  resolveCLIConfig: mockResolveCLIConfig,
}));

import { addonInstallHandler } from './install.js';

const ADDON_PATH = '/addons/my-addon';
const ADDON = { name: 'my-addon', path: ADDON_PATH };
const MANIFEST = { id: 'my-addon', name: 'My Addon', version: '1.0.0' };

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockResolveAddonProject.mockReturnValue(ADDON);
  mockReadAddonManifest.mockReturnValue(MANIFEST);
  mockResolveCLIConfig.mockReturnValue({
    httpUrl: 'http://localhost:3000',
    tokenPath: '/token',
  });
  mockFs.existsSync.mockImplementation(
    (p: string) => p === ADDON_PATH || p === path.join(ADDON_PATH, 'dist'),
  );
  mockReadFile.mockResolvedValue(JSON.stringify({ token: 'admin-token' }));
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
  );
});

describe('addonInstallHandler', () => {
  describe('project resolution errors', () => {
    it('returns exit 1 when no addons found', async () => {
      mockResolveAddonProject.mockReturnValue(null);
      mockListAddonProjects.mockReturnValue([]);

      const result = await addonInstallHandler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('No addons found');
      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('No addons found'),
      );
    });

    it('returns exit 1 with hint listing each addon when multiple exist', async () => {
      mockResolveAddonProject.mockReturnValue(null);
      mockListAddonProjects.mockReturnValue([
        { name: 'addon-a', path: '/a' },
        { name: 'addon-b', path: '/b' },
      ]);

      const result = await addonInstallHandler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Multiple addons found');
      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('addon-a'),
      );
    });
  });

  describe('successful install', () => {
    it('returns exit 0 and calls outro', async () => {
      const result = await addonInstallHandler([]);

      expect(result.exitCode).toBe(0);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('my-addon'),
      );
    });

    it('uses --server-url and --token from args', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      vi.stubGlobal('fetch', mockFetch);

      await addonInstallHandler([
        '--server-url',
        'http://custom:4000',
        '--token',
        'mytoken',
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:4000/api/addons',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer mytoken' }),
        }),
      );
    });
  });

  describe('install failure', () => {
    it('returns exit 1 when server returns 500', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ message: 'Internal error' }),
        }),
      );

      const result = await addonInstallHandler([]);

      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when server returns 409 (already installed)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({}),
          }),
      );

      const result = await addonInstallHandler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('already installed');
    });

    it('returns exit 1 when server is unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const result = await addonInstallHandler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });
});
