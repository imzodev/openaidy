/**
 * Addon Dev Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const { mockClack, mockFs, mockReadAddonManifest } = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
  mockFs: { existsSync: vi.fn() },
  mockReadAddonManifest: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);
vi.mock('node:fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('../../utils/project.js', () => ({
  readAddonManifest: mockReadAddonManifest,
}));

import { addonDevHandler } from './dev.js';

const PROJECT = process.cwd();
const MANIFEST = { id: 'my-addon', name: 'My Addon', version: '1.0.0' };

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockReadAddonManifest.mockReturnValue(MANIFEST);
  mockFs.existsSync.mockImplementation(
    (p: string) => p === PROJECT || p === path.join(PROJECT, 'src'),
  );
});

describe('addonDevHandler', () => {
  describe('successful start', () => {
    it('returns exit 0 and includes server URL in outro', async () => {
      const result = await addonDevHandler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:3000'),
      );
    });

    it('uses default port 3000 and host localhost', async () => {
      await addonDevHandler([]);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('localhost:3000'),
      );
    });
  });

  describe('failure', () => {
    it('returns exit 1 when addon.json is missing', async () => {
      mockReadAddonManifest.mockReturnValue(null);
      const result = await addonDevHandler([]);
      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when project directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = await addonDevHandler([]);
      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 when src/ directory is missing', async () => {
      mockFs.existsSync.mockImplementation((p: string) => p === PROJECT);
      const result = await addonDevHandler([]);
      expect(result.exitCode).toBe(1);
      expect(mockClack.log.error).toHaveBeenCalled();
    });
  });
});
