/**
 * ToolToggleGrid
 *
 * Compact, categorized grid of toggleable items.
 * All items are always visible — no accordion, no clicks needed to reveal tools.
 * Items are grouped into 2-column rows with thin category label dividers.
 */

import { For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import type { ToggleItem } from '../../lib/types';
import { groupByCategory } from '../../lib/utils';

export type { ToggleItem };

type ToolToggleGridProps = {
  items: ToggleItem[];
  enabledIds: Set<string>;
  updatingIds: Set<string>;
  onToggle: (id: string) => void;
  icon?: (isEnabled: boolean) => JSX.Element;
  defaultCategory?: string;
  categoryOrder?: string[];
  emptyMessage?: string;
};

const BADGE_CLASSES: Record<NonNullable<ToggleItem['badgeVariant']>, string> = {
  success:
    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  neutral: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  warning:
    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
};

// ── Single toggle row ─────────────────────────────────────────────────────────

function ToggleRow(props: {
  item: ToggleItem;
  isEnabled: boolean;
  isUpdating: boolean;
  onToggle: () => void;
  icon?: (isEnabled: boolean) => JSX.Element;
}) {
  return (
    <button
      onClick={props.onToggle}
      disabled={props.isUpdating || props.item.disabled}
      title={props.item.disabled ? props.item.disabledReason : undefined}
      class={[
        'w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded transition-colors',
        props.isEnabled
          ? 'bg-primary/5 dark:bg-primary/10 hover:bg-primary/10 dark:hover:bg-primary/15'
          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
        props.isUpdating
          ? 'opacity-60 cursor-wait'
          : props.item.disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Icon */}
      <Show when={props.icon}>
        <span class="flex-shrink-0">{props.icon!(props.isEnabled)}</span>
      </Show>

      {/* Label + description */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1 min-w-0">
          <span
            class={`text-sm font-medium truncate ${
              props.isEnabled
                ? 'text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {props.item.label}
          </span>
          <Show when={props.item.badge}>
            <span
              class={`flex-shrink-0 text-[10px] px-1 py-0.5 rounded-full ${
                BADGE_CLASSES[props.item.badgeVariant ?? 'neutral']
              }`}
            >
              {props.item.badge}
            </span>
          </Show>
        </div>
        <Show when={props.item.description}>
          <p class="text-xs leading-tight text-gray-400 dark:text-gray-500 truncate">
            {props.item.description}
          </p>
        </Show>
      </div>

      {/* Mini toggle */}
      <div
        class={`flex-shrink-0 relative inline-flex h-3.5 w-6 rounded-full border-2 border-transparent transition-colors ${
          props.isEnabled ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-600'
        }`}
      >
        <span
          class={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${
            props.isEnabled ? 'translate-x-2.5' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export function ToolToggleGrid(props: ToolToggleGridProps) {
  const defaultCategory = () => props.defaultCategory ?? 'Other';
  const categoryOrder = () => props.categoryOrder ?? [];

  const grouped = createMemo(() =>
    groupByCategory(props.items, defaultCategory(), categoryOrder()),
  );

  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <div class="flex items-center justify-center h-24">
          <p class="text-xs text-gray-400 dark:text-gray-500">
            {props.emptyMessage ?? 'No items available'}
          </p>
        </div>
      }
    >
      <div class="space-y-3">
        <For each={grouped()}>
          {(group) => (
            <div>
              {/* Non-interactive category label */}
              <div class="flex items-center gap-2 mb-1 px-1">
                <span class="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  {group.category}
                </span>
                <div class="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
              </div>

              {/* 2-column grid of rows */}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-0.5">
                <For each={group.items}>
                  {(item) => (
                    <ToggleRow
                      item={item}
                      isEnabled={props.enabledIds.has(item.id)}
                      isUpdating={props.updatingIds.has(item.id)}
                      onToggle={() => props.onToggle(item.id)}
                      icon={props.icon}
                    />
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
