import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';
import { useConfig } from './useConfig';

// Mock the API module
vi.mock('../../../lib/api', () => ({
  getConfig: vi.fn().mockResolvedValue({
    config: {
      defaults: { providerId: 'openai', modelId: 'gpt-4' },
      providers: [],
      agents: [],
    },
    status: { issues: [] },
  }),
  updateConfig: vi.fn().mockResolvedValue({
    config: {
      defaults: { providerId: 'openai', modelId: 'gpt-4' },
      providers: [],
      agents: [],
    },
    status: { issues: [] },
  }),
}));

// Mock tanstack query
vi.mock('@tanstack/solid-query', () => ({
  createQuery: vi.fn(() => ({
    data: {
      config: {
        defaults: { providerId: 'openai', modelId: 'gpt-4' },
        providers: [],
        agents: [],
      },
      status: { issues: [] },
    },
    isLoading: false,
    error: null,
  })),
  createMutation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return config query and mutation', () => {
    const { result } = renderHook(() => useConfig());

    expect(result.configQuery).toBeDefined();
    expect(result.updateMutation).toBeDefined();
    expect(result.config).toBeDefined();
  });

  it('should return rawJson signal', () => {
    const { result } = renderHook(() => useConfig());

    expect(result.rawJson).toBeDefined();
    expect(result.setRawJson).toBeDefined();
    expect(typeof result.rawJson()).toBe('string');
  });

  it('should return saveMessage signal', () => {
    const { result } = renderHook(() => useConfig());

    expect(result.saveMessage).toBeDefined();
    expect(result.setSaveMessage).toBeDefined();
    expect(result.saveMessage()).toBeNull();
  });

  it('should show save error', () => {
    const { result } = renderHook(() => useConfig());

    result.showSaveError('Test error');

    expect(result.saveMessage()).toEqual({
      type: 'error',
      text: 'Test error',
    });
  });

  it('should update rawJson', () => {
    const { result } = renderHook(() => useConfig());

    result.setRawJson('{"test": "value"}');

    expect(result.rawJson()).toBe('{"test": "value"}');
  });
});
