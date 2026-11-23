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
        class={`w-full px-3 py-3 md:py-2 rounded-lg text-left text-[13px] hover:bg-fill flex items-center gap-2 ${
          props.selectedAgentId === undefined
            ? 'bg-fill-strong text-text-primary font-medium'
            : 'text-text-tertiary'
        }`}
      >
        <Bot class="w-4 h-4 flex-shrink-0" />
        <span>Default agent</span>
      </button>

      <div class="h-px bg-separator my-1 mx-2" />

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
            class={`w-full px-3 py-3 md:py-2 rounded-lg text-left text-[13px] hover:bg-fill flex items-center gap-2 ${
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
            class="flex items-center gap-1.5 pl-2.5 pr-2 h-9 rounded-full bg-fill hover:bg-fill-strong disabled:opacity-50 disabled:cursor-not-allowed max-w-[180px] transition-colors"
          >
            <AgentIcon
              agent={selectedAgent()}
              class="w-4 h-4 text-text-tertiary"
            />
            <span class="flex-1 text-left text-[13px] font-medium text-text-secondary truncate">
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
          class="flex items-center justify-center w-8 h-8 rounded-full bg-fill text-text-tertiary hover:bg-fill-strong disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AgentIcon agent={selectedAgent()} class="w-4 h-4" />
        </button>
      </Show>

      {/* Desktop dropdown */}
      <Show when={isOpen() && variant() === 'inline'}>
        <div class="absolute bottom-full left-0 mb-2 w-full min-w-[240px] material-sheet rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-50 max-h-72 overflow-y-auto p-1 animate-sheet-in">
          <OptionList />
        </div>
      </Show>

      {/* Mobile bottom sheet */}
      <Show when={isOpen() && variant() === 'icon'}>
        <div
          class="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
        <div class="fixed inset-x-0 bottom-0 z-50 rounded-t-[22px] material-sheet shadow-2xl max-h-[70vh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-sheet-in">
          <div class="sticky top-0 flex items-center justify-between px-4 py-3 hairline-b material-sheet">
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
