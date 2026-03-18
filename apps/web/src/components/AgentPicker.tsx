import { Show, For, createSignal } from 'solid-js';
import { ChevronDown, Bot } from 'lucide-solid';
import type { Agent } from '../lib/api';

type AgentPickerProps = {
  agents: Agent[];
  selectedAgentId?: string;
  onSelect: (agentId: string | undefined) => void;
  disabled?: boolean;
};

export function AgentPicker(props: AgentPickerProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  const handleSelect = (agentId: string | undefined) => {
    props.onSelect(agentId);
    setIsOpen(false);
  };

  const selectedAgent = () => props.agents.find(a => a.id === props.selectedAgentId);

  return (
    <div class="relative flex-shrink-0">
      {/* Picker button */}
      <button
        type="button"
        onClick={() => !props.disabled && setIsOpen(!isOpen())}
        disabled={props.disabled}
        class="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
      >
        <Bot class="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <span class="flex-1 text-left text-sm text-gray-700 dark:text-gray-300 truncate">
          {selectedAgent()?.name ?? 'Default agent'}
        </span>
        <ChevronDown class="w-4 h-4 text-gray-400" />
      </button>

      {/* Dropdown */}
      <Show when={isOpen()}>
        <div class="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          {/* Default option */}
          <button
            type="button"
            onClick={() => handleSelect(undefined)}
            class="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-500 dark:text-gray-400"
          >
            <Bot class="w-4 h-4" />
            <span>Default agent</span>
          </button>

          {/* Divider */}
          <div class="border-t border-gray-200 dark:border-gray-700" />

          {/* Agent options */}
          <For each={props.agents.filter(a => a.enabled)}>
            {(agent) => (
              <button
                type="button"
                onClick={() => handleSelect(agent.id)}
                class={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 ${
                  props.selectedAgentId === agent.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                }`}
              >
                <Bot class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {agent.name}
                  </div>
                  <Show when={agent.description}>
                    <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {agent.description}
                    </div>
                  </Show>
                </div>
              </button>
            )}
          </For>

          {/* Empty state */}
          <Show when={props.agents.filter(a => a.enabled).length === 0}>
            <div class="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No agents available
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
