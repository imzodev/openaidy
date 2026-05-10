import { createSignal, Show } from 'solid-js';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-solid';
import type { JSX } from 'solid-js';

interface CollapsibleCardProps {
  title: string;
  index?: number;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'info' | 'warning' | 'error';
  description?: string;
  showEnabled?: boolean;
  enabled?: boolean;
  onDelete?: () => void;
  children: JSX.Element;
  isPending?: boolean;
  initiallyCollapsed?: boolean;
}

const badgeStyles = {
  default: 'bg-gray-100 dark:bg-gray-700 text-text-secondary',
  success:
    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  info: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  warning:
    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  error: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

export function CollapsibleCard(props: CollapsibleCardProps) {
  const [isCollapsed, setIsCollapsed] = createSignal(
    props.initiallyCollapsed ?? false,
  );

  return (
    <div class="border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
      <div class="flex items-center justify-between p-3 sm:p-4 bg-gray-50 dark:bg-gray-900/50 rounded-t-lg gap-2">
        <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Show when={props.index !== undefined}>
            <span class="text-sm font-medium text-text-tertiary shrink-0">
              #{props.index! + 1}
            </span>
          </Show>
          <h3 class="font-medium text-text-primary truncate">{props.title}</h3>
          <Show when={props.badge}>
            <span
              class={`hidden sm:inline px-2 py-0.5 text-xs rounded-full shrink-0 ${
                badgeStyles[props.badgeVariant || 'default']
              }`}
            >
              {props.badge}
            </span>
          </Show>
          <Show when={props.description}>
            <span class="hidden md:inline text-sm text-text-tertiary truncate">
              {props.description}
            </span>
          </Show>
          <Show when={props.showEnabled && props.enabled}>
            <span class="shrink-0 px-2 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              enabled
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setIsCollapsed(!isCollapsed())}
            class="p-1.5 text-text-tertiary hover:text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title={isCollapsed() ? 'Expand' : 'Collapse'}
          >
            <Show
              when={isCollapsed()}
              fallback={<ChevronDown class="w-4 h-4" />}
            >
              <ChevronRight class="w-4 h-4" />
            </Show>
          </button>
          <Show when={props.onDelete}>
            <button
              onClick={() => props.onDelete!()}
              disabled={props.isPending}
              class="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </Show>
        </div>
      </div>
      <Show when={!isCollapsed()}>
        <div class="p-4">{props.children}</div>
      </Show>
    </div>
  );
}
