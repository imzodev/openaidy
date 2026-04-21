/**
 * Addon Sidebar Component
 *
 * Displays dynamically loaded addon navigation items in the sidebar.
 */

import { Show, For } from 'solid-js';
import { Puzzle } from 'lucide-solid';
import type { SidebarItem } from '../lib/addon-loader';

/**
 * Props for AddonSidebarItems
 */
export interface AddonSidebarItemsProps {
  /** List of addon sidebar items to display */
  items: SidebarItem[];
  /** Currently active addon ID */
  activeAddonId?: string;
  /** Whether sidebar is collapsed */
  isCollapsed?: boolean;
  /** Callback when addon item is clicked */
  onSelect?: (addonId: string, path: string) => void;
  /** CSS class for container */
  class?: string;
}

/**
 * Addon sidebar items component
 *
 * Renders a list of addon navigation items that can be clicked to navigate
 * to specific addon pages.
 */
export function AddonSidebarItems(props: AddonSidebarItemsProps) {
  const handleClick = (item: SidebarItem) => {
    props.onSelect?.(item.addonId, item.path);
  };

  return (
    <div class={props.class}>
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            onClick={() => handleClick(item)}
            class={`w-full flex items-center gap-2 py-2 rounded-lg transition-colors ${
              props.activeAddonId === item.addonId
                ? 'bg-blue-50 dark:bg-blue-900/20 text-text-primary'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
            } ${props.isCollapsed ? 'justify-center px-0' : 'px-4 justify-start'}`}
            title={item.label}
          >
            <Puzzle class="w-5 h-5 flex-shrink-0" />
            <Show when={!props.isCollapsed}>
              <span class="text-sm truncate">{item.label}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

/**
 * Addon section wrapper
 *
 * Wraps addon items in a section with title (when not collapsed)
 */
export interface AddonSidebarSectionProps {
  items: SidebarItem[];
  activeAddonId?: string;
  isCollapsed?: boolean;
  onSelect?: (addonId: string, path: string) => void;
}

/**
 * Addon sidebar section
 */
export function AddonSidebarSection(props: AddonSidebarSectionProps) {
  return (
    <div class="mb-2">
      <Show when={!props.isCollapsed}>
        <h3 class="px-4 py-1 text-xs font-semibold text-text-muted uppercase tracking-wider">
          Addons
        </h3>
      </Show>
      <Show when={props.isCollapsed}>
        <div class="px-2 py-1">
          <div class="h-px bg-gray-200 dark:bg-gray-700" />
        </div>
      </Show>
      <AddonSidebarItems
        items={props.items}
        activeAddonId={props.activeAddonId}
        isCollapsed={props.isCollapsed}
        onSelect={props.onSelect}
      />
    </div>
  );
}

/**
 * Empty addon message
 *
 * Shown when no addons are installed
 */
export interface AddonEmptyStateProps {
  isCollapsed?: boolean;
  onClick?: () => void;
}

/**
 * Empty addon state component
 */
export function AddonEmptyState(props: AddonEmptyStateProps) {
  return (
    <Show when={!props.isCollapsed}>
      <div class="px-4 py-3">
        <p class="text-xs text-text-muted">No addons installed</p>
        <button
          type="button"
          onClick={props.onClick}
          class="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          Browse marketplace
        </button>
      </div>
    </Show>
  );
}

/**
 * Integration helper for merging addon sidebar items with existing navigation
 *
 * Usage:
 * ```
 * const allItems = mergeSidebarItems(baseItems, addonItems);
 * ```
 */
export function mergeSidebarItems(
  baseItems: SidebarItem[],
  addonItems: SidebarItem[],
): SidebarItem[] {
  // Sort all items by order
  return [...baseItems, ...addonItems].sort((a, b) => a.order - b.order);
}

/**
 * Create sidebar items from addon manifest
 *
 * Converts addon manifest sidebar config to SidebarItem format
 */
export function createSidebarItemsFromManifest(
  addonId: string,
  icon: string,
  label: string,
  order: number = 100,
): SidebarItem {
  return {
    addonId,
    icon,
    label,
    order,
    path: `/addons/${addonId}`,
  };
}
