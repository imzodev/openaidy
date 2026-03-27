import type { AppConfig, AgentConfig } from '../../../lib/api';

export function useAgents(
  config: () => AppConfig | undefined,
  updateConfigData: (config: AppConfig) => Promise<unknown>,
) {
  const addAgent = async () => {
    const currentConfig = config();
    if (!currentConfig) return;

    const newAgent: AgentConfig = {
      id: `agent-${Date.now()}`,
      name: 'New Agent',
      enabled: true,
      description: '',
      systemPrompt: 'You are a helpful assistant.',
      model: '',
    };

    const updatedConfig = {
      ...currentConfig,
      agents: [...(currentConfig.agents || []), newAgent],
    } as AppConfig;

    await updateConfigData(updatedConfig);
  };

  const deleteAgent = async (agentId: string) => {
    const currentConfig = config();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      agents: currentConfig.agents?.filter((a) => a.id !== agentId),
    } as AppConfig;

    await updateConfigData(updatedConfig);
  };

  const updateAgent = async (agentId: string, updatedAgent: AgentConfig) => {
    const currentConfig = config();
    if (!currentConfig) return;

    const updatedAgents = [...(currentConfig.agents || [])];
    const agentIndex = updatedAgents.findIndex((a) => a.id === agentId);

    if (agentIndex !== -1) {
      updatedAgents[agentIndex] = updatedAgent;
    }

    const mergedConfig = {
      ...currentConfig,
      agents: updatedAgents,
    } as AppConfig;

    await updateConfigData(mergedConfig);
  };

  return {
    addAgent,
    deleteAgent,
    updateAgent,
  };
}
