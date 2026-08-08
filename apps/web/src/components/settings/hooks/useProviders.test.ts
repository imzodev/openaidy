import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';
import { useProviders } from './useProviders';
import type { AppConfig } from '../../../lib/api';

// Mock config function
const mockConfig = () =>
  ({
    version: 1,
    defaults: { providerId: 'openai', modelId: 'gpt-4', agentId: 'default' },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai-compatible',
        enabled: true,
        models: [{ id: 'gpt-4', name: 'GPT-4', enabled: true }],
      },
    ],
    agents: [],
    execution: {
      maxRetries: 5,
      depContextPerItemChars: 2000,
      depContextTotalChars: 8000,
    },
  }) as AppConfig;

const mockUpdateConfigData = vi.fn().mockResolvedValue(undefined);
const mockShowError = vi.fn();

describe('useProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with closed modal', () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    expect(result.showAddProviderModal()).toBe(false);
  });

  it('should open add provider modal', () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    result.openAddProviderModal();

    expect(result.showAddProviderModal()).toBe(true);
  });

  it('should close add provider modal', () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    result.openAddProviderModal();
    expect(result.showAddProviderModal()).toBe(true);

    result.closeAddProviderModal();
    expect(result.showAddProviderModal()).toBe(false);
  });

  it('should initialize new provider data with defaults', () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    const data = result.newProviderData();
    expect(data.vendorFamily).toBe('openai-compatible');
    expect(data.enabled).toBe(true);
  });

  it('should update new provider data', () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    result.setNewProviderData({
      ...result.newProviderData(),
      id: 'anthropic',
      name: 'Anthropic',
    });

    expect(result.newProviderData().id).toBe('anthropic');
    expect(result.newProviderData().name).toBe('Anthropic');
  });

  it('should show error when saving provider without id or name', async () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    result.setNewProviderData({
      ...result.newProviderData(),
      id: '',
      name: '',
    });

    await result.saveNewProvider();

    expect(mockShowError).toHaveBeenCalledWith(
      'Provider ID and Name are required',
    );
    expect(mockUpdateConfigData).not.toHaveBeenCalled();
  });

  it('should delete provider', async () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    await result.deleteProvider('openai');

    expect(mockUpdateConfigData).toHaveBeenCalled();
    const updatedConfig = mockUpdateConfigData.mock.calls[0][0];
    expect(updatedConfig.providers).toHaveLength(0);
  });

  it('should update provider', async () => {
    const { result } = renderHook(() =>
      useProviders(mockConfig, mockUpdateConfigData, mockShowError),
    );

    const updatedProvider = {
      id: 'openai',
      name: 'OpenAI Updated',
      vendorFamily: 'openai-compatible' as const,
      enabled: true,
      models: [{ id: 'gpt-4', name: 'GPT-4', enabled: true }],
    };

    await result.updateProvider('openai', updatedProvider);

    expect(mockUpdateConfigData).toHaveBeenCalled();
    const updatedConfig = mockUpdateConfigData.mock.calls[0][0];
    expect(updatedConfig.providers[0].name).toBe('OpenAI Updated');
  });
});
