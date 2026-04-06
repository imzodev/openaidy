/**
 * Agent Selector Component
 *
 * Multi-select dropdown for choosing agents with avatars and roles.
 */

import { createSignal, Show, For } from 'solid-js';
import type { Agent } from '../../lib/api';

export type AgentSelectorProps = {
  agents: Agent[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
};

export function AgentSelector(props: AgentSelectorProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  const selectedAgents = () =>
    props.agents.filter((a) => props.selectedIds.includes(a.id));

  function toggleAgent(agentId: string) {
    const newSelection = props.selectedIds.includes(agentId)
      ? props.selectedIds.filter((id) => id !== agentId)
      : [...props.selectedIds, agentId];
    props.onChange(newSelection);
  }

  function clearAll() {
    props.onChange([]);
    setIsOpen(false);
  }

  return (
    <div class="agent-selector relative">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        Agents
      </label>

      {/* Selected agents display */}
      <div
        class={`min-h-[38px] w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 cursor-pointer flex flex-wrap gap-1 ${
          props.disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={() => !props.disabled && setIsOpen(!isOpen())}
      >
        <Show when={props.selectedIds.length === 0}>
          <span class="text-gray-400 dark:text-gray-500 text-sm">Select agents...</span>
        </Show>
        <For each={selectedAgents()}>
          {(agent) => (
            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
              {agent.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAgent(agent.id);
                }}
                class="hover:text-blue-900 dark:hover:text-blue-100"
              >
                ×
              </button>
            </span>
          )}
        </For>
      </div>

      {/* Dropdown */}
      <Show when={isOpen()}>
        <div class="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
          <div class="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-between">
            <span class="text-xs text-gray-500">
              {props.selectedIds.length} selected
            </span>
            <Show when={props.selectedIds.length > 0}>
              <button
                type="button"
                onClick={clearAll}
                class="text-xs text-blue-600 hover:text-blue-800"
              >
                Clear all
              </button>
            </Show>
          </div>
          <For each={props.agents}>
            {(agent) => (
              <div
                class={`px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                  props.selectedIds.includes(agent.id)
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : ''
                }`}
                onClick={() => toggleAgent(agent.id)}
              >
                <input
                  type="checkbox"
                  checked={props.selectedIds.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                  class="rounded border-gray-300"
                />
                <span class="text-sm text-gray-900 dark:text-gray-100">
                  {agent.name}
                </span>
                <Show when={!agent.enabled}>
                  <span class="text-xs text-gray-400">(disabled)</span>
                </Show>
              </div>
            )}
          </For>
          <Show when={props.agents.length === 0}>
            <div class="px-3 py-2 text-sm text-gray-500">No agents available</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
