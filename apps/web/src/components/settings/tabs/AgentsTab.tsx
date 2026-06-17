import { Show, For, createMemo } from 'solid-js';
import { Plus, Info, X } from 'lucide-solid';
import {
  DynamicConfigForm,
  getAgentsSectionSchema,
  type FormSchema,
} from '../../../config';
import { CollapsibleCard } from '../../ui';
import type {
  AppConfig,
  AgentConfig,
  ProviderConfig,
  RewiredAgentNotice,
} from '../../../lib/api';

interface AgentsTabProps {
  config: () => AppConfig | undefined;
  providers: ProviderConfig[];
  isPending: boolean;
  onAddAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onUpdateAgent: (agentId: string, agent: AgentConfig) => void;
  /**
   * Per-agent notices for agents whose `model` was auto-rewired
   * to the project default during a provider disconnect. The
   * Agents tab renders a dismissible banner on each affected
   * agent's card.
   */
  rewiredNotices: RewiredAgentNotice[];
  /** Parent-owned dismissal so all the state lives in SettingsView. */
  onDismissRewireNotice: (agentId: string) => void;
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

  // Index notices by agentId for O(1) lookup during render.
  const noticesByAgent = createMemo(() => {
    const map = new Map<string, RewiredAgentNotice>();
    for (const n of props.rewiredNotices) map.set(n.agentId, n);
    return map;
  });

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
          {(agent) => {
            const notice = () => noticesByAgent().get(agent.id);
            return (
              <CollapsibleCard
                title={agent.name}
                description={agent.description}
                showEnabled={true}
                enabled={agent.enabled}
                onDelete={() => props.onDeleteAgent(agent.id)}
                isPending={props.isPending}
                notice={
                  <Show when={notice()}>
                    {(n) => (
                      <RewiredAgentBanner
                        notice={n()}
                        onDismiss={() =>
                          props.onDismissRewireNotice(n().agentId)
                        }
                      />
                    )}
                  </Show>
                }
              >
                <DynamicConfigForm
                  config={{ agents: [agent] } as Record<string, unknown>}
                  schema={agentsSchema()}
                  onChange={(newConfig) =>
                    handleAgentChange(agent.id, newConfig)
                  }
                  errors={{}}
                  providers={props.providers}
                />
              </CollapsibleCard>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

function RewiredAgentBanner(props: {
  notice: RewiredAgentNotice;
  onDismiss: () => void;
}) {
  return (
    <div class="mb-3 flex items-start gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-2 text-xs text-blue-800 dark:text-blue-200">
      <Info class="w-4 h-4 mt-0.5 shrink-0" />
      <div class="flex-1">
        <p>
          The model was changed from{' '}
          <code class="font-mono">{props.notice.fromModel}</code> to{' '}
          <code class="font-mono">{props.notice.toModel}</code> because{' '}
          <strong>{props.notice.fromProviderId}</strong> was disconnected. Pick
          a different model if you don't want the project default.
        </p>
      </div>
      <button
        type="button"
        onClick={props.onDismiss}
        class="shrink-0 p-0.5 rounded text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
        title="Dismiss"
        aria-label="Dismiss notice"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
