/**
 * Agent Selector Component
 *
 * Multi-select dropdown for selecting agents with role assignment.
 */

import { createSignal, Show, For } from 'solid-js';
import { ChevronDown, X, User } from 'lucide-solid';
import type { AgentRole } from '../../lib/api-tasks';

/**
 * Agent type (from API)
 */
export type Agent = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
};

/**
 * Selected agent with optional role
 */
export type SelectedAgent = {
  agentId: string;
  role?: AgentRole;
};

/**
 * AgentSelector Props
 */
export type AgentSelectorProps = {
  agents: Agent[];
  selectedAgents: SelectedAgent[];
  onChange: (selectedAgents: SelectedAgent[]) => void;
  disabled?: boolean;
};

/**
 * Agent roles
 */
const AGENT_ROLES: AgentRole[] = ['primary', 'secondary', 'reviewer'];

/**
 * Role badge colors
 */
const ROLE_COLORS: Record<AgentRole, string> = {
  primary: 'bg-blue-100 text-blue-700',
  secondary: 'bg-gray-100 text-gray-700',
  reviewer: 'bg-purple-100 text-purple-700',
};

/**
 * AgentSelector Component
 */
export function AgentSelector(props: AgentSelectorProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  /**
   * Toggle agent selection
   */
  function toggleAgent(agentId: string) {
    const isSelected = props.selectedAgents.some((a) => a.agentId === agentId);
    if (isSelected) {
      props.onChange(props.selectedAgents.filter((a) => a.agentId !== agentId));
    } else {
      props.onChange([...props.selectedAgents, { agentId, role: 'primary' }]);
    }
  }

  /**
   * Update agent role
   */
  function updateRole(agentId: string, role: AgentRole) {
    props.onChange(
      props.selectedAgents.map((a) => (a.agentId === agentId ? { ...a, role } : a))
    );
  }

  /**
   * Remove agent
   */
  function removeAgent(agentId: string) {
    props.onChange(props.selectedAgents.filter((a) => a.agentId !== agentId));
  }

  /**
   * Clear all selected agents
   */
  function clearAll() {
    props.onChange([]);
    setIsOpen(false);
  }

  /**
   * Get agent by ID
   */
  function getAgent(agentId: string): Agent | undefined {
    return props.agents.find((a) => a.id === agentId);
  }

  return (
    <div class="agent-selector">
      {/* Selected agents display */}
      <Show when={props.selectedAgents.length > 0}>
        <div class="flex flex-wrap gap-2 mb-2">
          <For each={props.selectedAgents}>
            {(selected) => {
              const agent = () => getAgent(selected.agentId);
              return (
                <Show when={agent()}>
                  <div class="flex items-center gap-1 bg-gray-100 rounded-full pl-2 pr-1 py-1">
                    <User class="w-3 h-3 text-gray-500" />
                    <span class="text-sm">{agent()!.name}</span>
                    <select
                      class={`text-xs px-1.5 py-0.5 rounded ${ROLE_COLORS[selected.role || 'primary']}`}
                      value={selected.role || 'primary'}
                      onChange={(e) => updateRole(selected.agentId, e.target.value as AgentRole)}
                      disabled={props.disabled}
                    >
                      <For each={AGENT_ROLES}>
                        {(role) => <option value={role}>{role}</option>}
                      </For>
                    </select>
                    <button
                      type="button"
                      class="p-0.5 hover:bg-gray-200 rounded-full"
                      onClick={() => removeAgent(selected.agentId)}
                      disabled={props.disabled}
                    >
                      <X class="w-3 h-3 text-gray-500" />
                    </button>
                  </div>
                </Show>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Dropdown trigger */}
      <div class="relative">
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
          onClick={() => setIsOpen(!isOpen())}
          disabled={props.disabled}
        >
          <span class="text-sm text-gray-700">Select agents...</span>
          <ChevronDown class="w-4 h-4 text-gray-500" />
        </button>

        {/* Dropdown menu */}
        <Show when={isOpen()}>
          <div class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
            {/* Clear all button */}
            <Show when={props.selectedAgents.length > 0}>
              <button
                type="button"
                class="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                onClick={clearAll}
              >
                Clear all
              </button>
              <div class="border-t border-gray-100" />
            </Show>

            {/* Agent list */}
            <Show when={props.agents.length === 0}>
              <div class="px-3 py-2 text-sm text-gray-500">No agents available</div>
            </Show>

            <For each={props.agents}>
              {(agent) => {
                const isSelected = () =>
                  props.selectedAgents.some((a) => a.agentId === agent.id);
                return (
                  <button
                    type="button"
                    class={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 ${
                      isSelected() ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <div
                      class={`w-4 h-4 border rounded flex items-center justify-center ${
                        isSelected()
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-gray-300'
                      }`}
                    >
                      <Show when={isSelected()}>
                        <svg
                          class="w-3 h-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </Show>
                    </div>
                    <User class="w-4 h-4 text-gray-400" />
                    <span class="text-gray-900">{agent.name}</span>
                    <Show when={agent.description}>
                      <span class="text-gray-500 text-xs truncate">
                        {agent.description}
                      </span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
