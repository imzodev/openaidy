/**
 * Addon Templates Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClack, mockListTemplates } = vi.hoisted(() => ({
  mockClack: {
    note: vi.fn(),
  },
  mockListTemplates: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);

vi.mock('../../utils/template-generator.js', () => ({
  listTemplates: mockListTemplates,
}));

import { addonTemplatesHandler } from './templates.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addonTemplatesHandler', () => {
  it('returns exit 0', async () => {
    mockListTemplates.mockReturnValue([]);
    const result = await addonTemplatesHandler([]);
    expect(result.exitCode).toBe(0);
  });

  it('calls p.note with formatted template list', async () => {
    mockListTemplates.mockReturnValue([
      { name: 'basic', description: 'A minimal addon' },
      { name: 'agent', description: 'An agent addon' },
    ]);

    await addonTemplatesHandler([]);

    expect(mockClack.note).toHaveBeenCalledWith(
      expect.stringContaining('basic'),
      'Available Templates',
    );
    expect(mockClack.note).toHaveBeenCalledWith(
      expect.stringContaining('A minimal addon'),
      'Available Templates',
    );
  });

  it('shows each template on its own line', async () => {
    mockListTemplates.mockReturnValue([
      { name: 'basic', description: 'Minimal' },
      { name: 'agent', description: 'Agent' },
    ]);

    await addonTemplatesHandler([]);

    const [body] = mockClack.note.mock.calls[0] as [string, string];
    const lines = body.split('\n');
    expect(lines).toHaveLength(2);
  });
});
