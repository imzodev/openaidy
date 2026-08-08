import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';
import { useAgents } from './useAgents';
import type { AppConfig } from '../../../lib/api';

// Mock config function
const mockConfig = () =>
  ({
    version: 1,
    defaults: { providerId: 'openai', modelId: 'gpt-4', agentId: 'default' },
    providers: [],
    agents: [
      {
        id: 'default',
        name: 'Default Agent',
        enabled: true,
        description: 'Default assistant',
        systemPrompt: 'You are a helpful assistant.',
        model: 'gpt-4',
      },
    ],
    execution: {
      maxRetries: 5,
      depContextPerItemChars: 2000,
      depContextTotalChars: 8000,
    },
  }) as AppConfig;

const mockUpdateConfigData = vi.fn().mockResolvedValue(undefined);

describe('useAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should add a new agent', async () => {
    const { result } = renderHook(() =>
      useAgents(mockConfig, mockUpdateConfigData),
    );

    await result.addAgent();

    expect(mockUpdateConfigData).toHaveBeenCalled();
    const updatedConfig = mockUpdateConfigData.mock.calls[0][0];
    expect(updatedConfig.agents).toHaveLength(2);
    expect(updatedConfig.agents[1].name).toBe('New Agent');
  });

  it('should delete an agent', async () => {
    const { result } = renderHook(() =>
      useAgents(mockConfig, mockUpdateConfigData),
    );

    await result.deleteAgent('default');

    expect(mockUpdateConfigData).toHaveBeenCalled();
    const updatedConfig = mockUpdateConfigData.mock.calls[0][0];
    expect(updatedConfig.agents).toHaveLength(0);
  });

  it('should update an agent', async () => {
    const { result } = renderHook(() =>
      useAgents(mockConfig, mockUpdateConfigData),
    );

    const updatedAgent = {
      id: 'default',
      name: 'Updated Agent',
      enabled: false,
      description: 'Updated description',
      systemPrompt: 'New prompt',
      model: 'gpt-4',
    };

    await result.updateAgent('default', updatedAgent);

    expect(mockUpdateConfigData).toHaveBeenCalled();
    const updatedConfig = mockUpdateConfigData.mock.calls[0][0];
    expect(updatedConfig.agents[0].name).toBe('Updated Agent');
    expect(updatedConfig.agents[0].enabled).toBe(false);
  });

  it('should not update if agent not found', async () => {
    const { result } = renderHook(() =>
      useAgents(mockConfig, mockUpdateConfigData),
    );

    const updatedAgent = {
      id: 'non-existent',
      name: 'Updated Agent',
      enabled: true,
      description: '',
      systemPrompt: '',
      model: '',
    };

    await result.updateAgent('non-existent', updatedAgent);

    expect(mockUpdateConfigData).toHaveBeenCalled();
    // Agent list should remain unchanged since the id wasn't found
    const updatedConfig = mockUpdateConfigData.mock.calls[0][0];
    expect(updatedConfig.agents[0].name).toBe('Default Agent');
  });
});
