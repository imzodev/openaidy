/**
 * Agents Delete Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile, mockWriteFile, mockClack } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockClack: {
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    log: { error: vi.fn(), warn: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    select: vi.fn(),
    text: vi.fn(),
    isCancel: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));
vi.mock('@clack/prompts', () => mockClack);

import { agentsDeleteHandler } from './delete.js';

const BASE_CONFIG = {
  version: 1,
  agents: [
    {
      id: 'default',
      name: 'Default',
      enabled: true,
      model: 'openai/gpt-4o-mini',
      systemPrompt: 'You are helpful.',
      description: 'Default agent',
      version: 1,
      tags: [],
    },
    {
      id: 'coder',
      name: 'Code Assistant',
      enabled: true,
      model: 'openai/gpt-4o',
      systemPrompt: 'You write code.',
      description: 'Coding agent',
      version: 1,
      tags: ['coding'],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockReadFile.mockResolvedValue(JSON.stringify(BASE_CONFIG));
  mockWriteFile.mockResolvedValue(undefined);
  mockClack.isCancel.mockReturnValue(false);
});

describe('agents delete', () => {
  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await agentsDeleteHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.log.error).not.toHaveBeenCalled();
    });

    it('shows help with -h', async () => {
      const result = await agentsDeleteHandler(['-h']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('no agents in config', () => {
    it('warns and exits 0 when no agents exist', async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ version: 1, agents: [] }),
      );
      const result = await agentsDeleteHandler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.log.warn).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('agent id passed as argument', () => {
    it('deletes agent when confirmation matches', async () => {
      mockClack.text.mockResolvedValue('default');

      const result = await agentsDeleteHandler(['default']);

      expect(result.exitCode).toBe(0);
      expect(mockWriteFile).toHaveBeenCalledOnce();

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.agents).toHaveLength(1);
      expect(written.agents[0].id).toBe('coder');
    });

    it('returns exit 1 when confirmation does not match', async () => {
      mockClack.text.mockResolvedValue('wrong-id');

      const result = await agentsDeleteHandler(['default']);

      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('Confirmation mismatch');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('returns exit 1 when agent id is not found', async () => {
      const result = await agentsDeleteHandler(['nonexistent']);

      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch('Agent not found');
      expect(mockClack.log.error).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('interactive prompt (no id argument)', () => {
    it('prompts for agent and deletes on confirmation', async () => {
      mockClack.select.mockResolvedValue('coder');
      mockClack.text.mockResolvedValue('coder');

      const result = await agentsDeleteHandler([]);

      expect(result.exitCode).toBe(0);
      expect(mockClack.select).toHaveBeenCalledOnce();
      expect(mockWriteFile).toHaveBeenCalledOnce();

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.agents).toHaveLength(1);
      expect(written.agents[0].id).toBe('default');
    });

    it('cancels cleanly when select is cancelled', async () => {
      mockClack.isCancel.mockReturnValue(true);
      mockClack.select.mockResolvedValue(Symbol('cancel'));

      const result = await agentsDeleteHandler([]);

      expect(result.exitCode).toBe(0);
      expect(mockClack.cancel).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('cancels cleanly when text confirmation is cancelled', async () => {
      mockClack.select.mockResolvedValue('default');
      mockClack.isCancel
        .mockReturnValueOnce(false) // select not cancelled
        .mockReturnValueOnce(true); // text cancelled
      mockClack.text.mockResolvedValue(Symbol('cancel'));

      const result = await agentsDeleteHandler([]);

      expect(result.exitCode).toBe(0);
      expect(mockClack.cancel).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('config persistence', () => {
    it('preserves all other agents and config fields after deletion', async () => {
      const configWithExtras = {
        ...BASE_CONFIG,
        someOtherField: 'keep-me',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(configWithExtras));
      mockClack.text.mockResolvedValue('default');

      await agentsDeleteHandler(['default']);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.someOtherField).toBe('keep-me');
      expect(written.version).toBe(1);
      expect(written.agents).toHaveLength(1);
      expect(written.agents[0].id).toBe('coder');
    });

    it('writes JSON with trailing newline', async () => {
      mockClack.text.mockResolvedValue('default');

      await agentsDeleteHandler(['default']);

      const raw = mockWriteFile.mock.calls[0][1] as string;
      expect(raw.endsWith('\n')).toBe(true);
    });
  });
});
