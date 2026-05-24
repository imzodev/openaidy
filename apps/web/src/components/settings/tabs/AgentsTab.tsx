import { Show, For, createMemo } from 'solid-js';
import { Plus } from 'lucide-solid';
import {
  DynamicConfigForm,
  getAgentsSectionSchema,
  type FormSchema,
} from '../../../config';
import { CollapsibleCard } from '../../ui';
import type { AppConfig, AgentConfig, ProviderConfig } from '../../../lib/api';

interface AgentsTabProps {
  config: () => AppConfig | undefined;
  providers: ProviderConfig[];
  isPending: boolean;
  onAddAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onUpdateAgent: (agentId: string, agent: AgentConfig) => void;
}

export function AgentsTab(props: AgentsTabProps) {
  const agentsSchema = createMemo((): FormSchema => {
    return {
      sections: [getAgentsSectionSchema()],
    };
  });

  const handleAgentChange = (
    agentId: string,
    newConfig: Record<string, unknown>,
  ) => {
    const currentConfig = props.config();
    if (!currentConfig || !Array.isArray(newConfig.agents)) return;

    const updatedAgent = newConfig.agents[0] as AgentConfig;
    props.onUpdateAgent(agentId, updatedAgent);
  };

  return (
    <div class="p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-text-primary">Agents</h2>
        <button
          onClick={() => props.onAddAgent()}
          disabled={props.isPending}
          class="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg transition-colors text-sm font-medium"
        >
          <Plus class="w-4 h-4" />
          Add Agent
        </button>
      </div>

      <Show
        when={(props.config()?.agents?.length ?? 0) > 0}
        fallback={
          <div class="text-center py-8 text-text-tertiary">
            <p>No agents configured.</p>
            <p class="text-sm mt-2">Click "Add Agent" to add a new agent.</p>
          </div>
        }
      >
        <For each={props.config()?.agents}>
          {(agent) => (
            <CollapsibleCard
              title={agent.name}
              description={agent.description}
              showEnabled={true}
              enabled={agent.enabled}
              onDelete={() => props.onDeleteAgent(agent.id)}
              isPending={props.isPending}
            >
              <DynamicConfigForm
                config={{ agents: [agent] } as Record<string, unknown>}
                schema={agentsSchema()}
                onChange={(newConfig) => handleAgentChange(agent.id, newConfig)}
                errors={{}}
                providers={props.providers}
              />
            </CollapsibleCard>
          )}
        </For>
      </Show>
    </div>
  );
}
