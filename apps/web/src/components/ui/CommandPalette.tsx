import {
  createMemo,
  createSignal,
  For,
  Show,
  onMount,
  onCleanup,
  createEffect,
} from 'solid-js';
import { Search } from 'lucide-solid';
import {
  buildStaticCommands,
  recentAgentCommand,
  recentSessionCommand,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Command,
  type CommandCategory,
  type CommandContext,
} from './command-registry';
import {
  recentSessionsSignal,
  recentAgentsSignal,
} from '../../stores/recent-items';
import { fuzzyFilter } from '../../lib/fuzzy';

/**
 * Text the fuzzy scorer matches against. Pulls in the label, hint and
 * keywords so e.g. "Stop Agent" is also findable by typing "cancel" via its
 * keywords.
 */
function commandSearchText(cmd: Command): string {
  const parts = [cmd.label];
  if (cmd.hint) parts.push(cmd.hint);
  if (cmd.keywords?.length) parts.push(cmd.keywords.join(' '));
  return parts.join(' ');
}

export type CommandPaletteProps = {
  ctx: CommandContext;
  isOpen: () => boolean;
  onClose: () => void;
};

/**
 * Command palette modal with fuzzy search and category grouping.
 *
 * Implementation note: rather than leaning on Kobalte's Combobox state
 * machine (which closes the listbox whenever the filtered collection goes
 * empty), we render a plain modal with our own input + grouped list. The
 * palette only appears while `isOpen()` is true and unmounts on close, so
 * we don't need to coordinate Kobalte's portal state — using a plain
 * controlled input keeps the interaction model predictable.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal('');
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  // Build the full command list per render. Recent entries are reactive
  // because the signals they read are reactive.
  const allCommands = createMemo<Command[]>(() => {
    const static_ = buildStaticCommands(props.ctx);
    const recents: Command[] = [
      ...recentSessionsSignal().map((s) => recentSessionCommand(s, props.ctx)),
      ...recentAgentsSignal().map((a) => recentAgentCommand(a, props.ctx)),
    ];
    return [...recents, ...static_];
  });

  const filtered = createMemo<Command[]>(() => {
    const list = allCommands().filter((c) => !c.hidden);
    return fuzzyFilter(query(), list, commandSearchText);
  });

  // Group by category, preserving CATEGORY_ORDER. Empty categories are omitted.
  const grouped = createMemo<
    { category: CommandCategory; commands: Command[] }[]
  >(() => {
    const buckets = new Map<CommandCategory, Command[]>();
    for (const cmd of filtered()) {
      const list = buckets.get(cmd.category) ?? [];
      list.push(cmd);
      buckets.set(cmd.category, list);
    }
    return CATEGORY_ORDER.flatMap((cat) => {
      const cmds = buckets.get(cat);
      return cmds && cmds.length > 0 ? [{ category: cat, commands: cmds }] : [];
    });
  });

  const flatList = createMemo<Command[]>(() =>
    grouped().flatMap((g) => g.commands),
  );

  // Reset highlight whenever the visible list shape changes.
  createEffect(() => {
    const total = flatList().length;
    if (total === 0) {
      setHighlightedIndex(0);
    } else if (highlightedIndex() >= total) {
      setHighlightedIndex(total - 1);
    }
  });

  // Focus the input when the palette opens; reset its state on open too.
  createEffect(() => {
    if (props.isOpen()) {
      setQuery('');
      setHighlightedIndex(0);
      // Defer one frame so the input is in the DOM and visible.
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const runCommand = (cmd: Command) => {
    if (cmd.disabled) return;
    props.onClose();
    // Defer the action a tick so the palette finishes closing first.
    queueMicrotask(() => cmd.run(props.ctx));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, flatList().length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flatList()[highlightedIndex()];
      if (cmd) runCommand(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlightedIndex(Math.max(0, flatList().length - 1));
    }
  };

  return (
    <Show when={props.isOpen()}>
      <div
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div
          class="w-full max-w-xl rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden"
          data-testid="command-palette"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <Search class="w-4 h-4 text-text-tertiary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Command palette"
              aria-expanded="true"
              aria-controls="command-palette-listbox"
              aria-activedescendant={
                flatList()[highlightedIndex()]
                  ? `command-palette-item-${flatList()[highlightedIndex()].id}`
                  : undefined
              }
              class="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-tertiary"
              placeholder="Type a command or search…"
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              data-testid="command-palette-input"
            />
            <kbd class="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-[10px] font-medium text-text-tertiary">
              esc
            </kbd>
          </div>

          <div
            id="command-palette-listbox"
            role="listbox"
            class="max-h-[60vh] overflow-y-auto py-1"
          >
            <Show
              when={flatList().length > 0}
              fallback={
                <div
                  class="px-4 py-8 text-center text-sm text-text-tertiary"
                  data-testid="command-palette-empty"
                >
                  No commands match &ldquo;{query()}&rdquo;.
                </div>
              }
            >
              <For each={grouped()}>
                {(group, groupIdx) => (
                  <div class={groupIdx() > 0 ? 'mt-1' : ''}>
                    <div class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                      {CATEGORY_LABELS[group.category]}
                    </div>
                    <For each={group.commands}>
                      {(cmd) => {
                        const indexInFlat = () =>
                          flatList().findIndex((c) => c.id === cmd.id);
                        const isHighlighted = () =>
                          indexInFlat() === highlightedIndex();
                        return (
                          <button
                            type="button"
                            role="option"
                            id={`command-palette-item-${cmd.id}`}
                            aria-selected={isHighlighted()}
                            data-command-id={cmd.id}
                            data-highlighted={isHighlighted()}
                            onMouseEnter={() =>
                              setHighlightedIndex(indexInFlat())
                            }
                            onClick={() => runCommand(cmd)}
                            class={
                              'w-full text-left flex items-center gap-3 px-3 py-2 text-sm transition-colors ' +
                              (isHighlighted()
                                ? 'bg-blue-50 dark:bg-blue-900/30 text-text-primary'
                                : 'text-text-secondary hover:bg-gray-50 dark:hover:bg-gray-700/50')
                            }
                          >
                            <span class="flex h-5 w-5 items-center justify-center text-text-tertiary shrink-0">
                              <Show when={cmd.icon}>
                                {(() => {
                                  const Icon = cmd.icon!;
                                  return <Icon class="w-4 h-4" />;
                                })()}
                              </Show>
                            </span>
                            <span class="flex-1 min-w-0 truncate">
                              {cmd.label}
                              <Show when={cmd.hint}>
                                <span class="ml-2 text-xs text-text-tertiary">
                                  {cmd.hint}
                                </span>
                              </Show>
                            </span>
                            <Show when={cmd.shortcut}>
                              <kbd class="text-[10px] font-medium text-text-tertiary bg-gray-100 dark:bg-gray-900 px-1.5 py-0.5 rounded">
                                {cmd.shortcut}
                              </kbd>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 text-[10px] text-text-tertiary flex items-center justify-between">
            <span>
              <kbd class="font-medium">↑↓</kbd> navigate ·{' '}
              <kbd class="font-medium">↵</kbd> select ·{' '}
              <kbd class="font-medium">esc</kbd> close
            </span>
            <span>{flatList().length} commands</span>
          </div>
        </div>
      </div>
    </Show>
  );
}

/**
 * Subscribe to ⌘K / Ctrl+K and toggle a signal.
 *
 * The host owns the open state so the palette integrates with the rest of
 * the app's UI (e.g. avoiding to stack on top of modal dialogs).
 */
export function useCommandPaletteHotkey(
  setOpen: (open: boolean) => void,
): void {
  onMount(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent) => {
      const isToggle =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isToggle) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });
}
