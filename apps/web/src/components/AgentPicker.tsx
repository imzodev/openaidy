import { Show, For, createSignal } from 'solid-js';
import { ChevronDown, Bot, X } from 'lucide-solid';
import type { Agent } from '../lib/api';

type AgentPickerProps = {
  agents: Agent[];
  selectedAgentId?: string;
  onSelect: (agentId: string | undefined) => void;
  disabled?: boolean;
  /**
   * Presentation:
   *  - 'inline' (default): fixed-width button + upward dropdown (desktop).
   *  - 'icon': a single round icon button + full-width bottom sheet (mobile).
   *    Icon-only keeps the composer to one compact row; the agent's name (and
   *    every option's name + description) is shown in the sheet when picking.
   */
  variant?: 'inline' | 'icon';
};

export function AgentPicker(props: AgentPickerProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const variant = () => props.variant ?? 'inline';
  const enabledAgents = () => props.agents.filter((a) => a.enabled);

  const handleSelect = (agentId: string | undefined) => {
    props.onSelect(agentId);
    setIsOpen(false);
  };

  const selectedAgent = () =>
    props.agents.find((a) => a.id === props.selectedAgentId);
  const selectedLabel = () => selectedAgent()?.name ?? 'Default agent';

  // Chip icon for the trigger button: agent's emoji when set, otherwise the
  // neutral bot icon fallback.
  const AgentIcon = (p: { agent?: Agent; class: string }) => (
    <Show when={p.agent?.identity?.emoji} fallback={<Bot class={p.class} />}>
      <span class="leading-none" aria-hidden="true">
        {p.agent?.identity?.emoji}
      </span>
    </Show>
  );

  // Option list shared by the desktop dropdown and the mobile bottom sheet.
  const OptionList = () => (
    <>
      <button
        type="button"
        onClick={() => handleSelect(undefined)}
        class={`w-full px-3 py-3 md:py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 ${
          props.selectedAgentId === undefined
            ? 'bg-blue-50 dark:bg-blue-900/30 text-text-primary'
            : 'text-text-tertiary'
        }`}
      >
        <Bot class="w-4 h-4 flex-shrink-0" />
        <span>Default agent</span>
      </button>

      <div class="border-t border-gray-200 dark:border-gray-700" />

      <For each={enabledAgents()}>
        {(agent) => (
          <button
            type="button"
            onClick={() => handleSelect(agent.id)}
            style={
              agent.identity?.accentColor
                ? { 'border-left': `2px solid ${agent.identity.accentColor}` }
                : undefined
            }
            class={`w-full px-3 py-3 md:py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 ${
              agent.identity?.accentColor ? '' : 'border-l-2 border-transparent'
            } ${
              props.selectedAgentId === agent.id
                ? 'bg-blue-50 dark:bg-blue-900/30'
                : ''
            }`}
          >
            <AgentIcon
              agent={agent}
              class="w-4 h-4 text-text-tertiary flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="font-medium text-text-primary truncate">
                {agent.name}
              </div>
              <Show when={agent.description}>
                <div class="text-xs text-text-tertiary truncate">
                  {agent.description}
                </div>
              </Show>
            </div>
          </button>
        )}
      </For>

      <Show when={enabledAgents().length === 0}>
        <div class="px-3 py-4 text-center text-sm text-text-tertiary">
          No agents available
        </div>
      </Show>
    </>
  );

  return (
    <div
      class={
        variant() === 'inline' ? 'relative flex-shrink-0' : 'flex-shrink-0'
      }
    >
      {/* Trigger */}
      <Show
        when={variant() === 'icon'}
        fallback={
          <button
            type="button"
            onClick={() => !props.disabled && setIsOpen(!isOpen())}
            disabled={props.disabled}
            aria-label="Select agent"
            class="flex items-center gap-2 px-3 h-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
          >
            <AgentIcon
              agent={selectedAgent()}
              class="w-4 h-4 text-text-tertiary"
            />
            <span class="flex-1 text-left text-sm text-text-secondary truncate">
              {selectedLabel()}
            </span>
            <ChevronDown class="w-4 h-4 text-text-tertiary" />
          </button>
        }
      >
        <button
          type="button"
          onClick={() => !props.disabled && setIsOpen(true)}
          disabled={props.disabled}
          aria-label="Select agent"
          title={selectedLabel()}
          class="flex items-center justify-center w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-tertiary hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AgentIcon agent={selectedAgent()} class="w-4 h-4" />
        </button>
      </Show>

      {/* Desktop dropdown */}
      <Show when={isOpen() && variant() === 'inline'}>
        <div class="absolute bottom-full left-0 mb-1 w-full min-w-[220px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          <OptionList />
        </div>
      </Show>

      {/* Mobile bottom sheet */}
      <Show when={isOpen() && variant() === 'icon'}>
        <div
          class="fixed inset-0 z-40 bg-black/40"
          onClick={() => setIsOpen(false)}
        />
        <div class="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-2xl max-h-[70vh] overflow-y-auto pb-6">
          <div class="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <span class="text-sm font-medium text-text-primary">
              Choose an agent
            </span>
            <button
              type="button"
              aria-label="Close agent picker"
              onClick={() => setIsOpen(false)}
              class="p-1 text-text-tertiary hover:text-text-primary"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
          <OptionList />
        </div>
      </Show>
    </div>
  );
}
