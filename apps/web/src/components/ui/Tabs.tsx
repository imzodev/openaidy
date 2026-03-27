import { For } from 'solid-js';

export interface Tab<T extends string> {
  id: T;
  label: string;
}

interface TabsProps<T extends string> {
  tabs: Tab<T>[];
  activeTab: () => T;
  onTabChange: (tab: T) => void;
}

export function Tabs<T extends string>(props: TabsProps<T>) {
  return (
    <div class="bg-white dark:bg-gray-800 shadow rounded-t-lg">
      <div class="border-b border-gray-200 dark:border-gray-700">
        <nav class="flex -mb-px" aria-label="Tabs">
          <For each={props.tabs}>
            {(tab) => (
              <button
                onClick={() => props.onTabChange(tab.id)}
                class={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  props.activeTab() === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {tab.label}
              </button>
            )}
          </For>
        </nav>
      </div>
    </div>
  );
}
