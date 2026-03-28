import { Show } from 'solid-js';
import { Sun, Moon, Monitor } from 'lucide-solid';
import { useTheme } from '../lib/theme';

interface ThemeToggleProps {
  isCollapsed?: boolean;
}

export function ThemeToggle(props: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'system' as const, icon: Monitor, label: 'Auto' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
  ];

  return (
    <Show
      when={!props.isCollapsed}
      fallback={
        <div class="flex flex-col items-center gap-2 py-2">
          <button
            onClick={() => {
              const current = theme();
              const next =
                current === 'light'
                  ? 'dark'
                  : current === 'dark'
                    ? 'system'
                    : 'light';
              setTheme(next);
            }}
            class="p-2 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={`Theme: ${theme()}`}
          >
            <Show when={theme() === 'light'}>
              <Sun class="w-4 h-4" />
            </Show>
            <Show when={theme() === 'dark'}>
              <Moon class="w-4 h-4" />
            </Show>
            <Show when={theme() === 'system'}>
              <Monitor class="w-4 h-4" />
            </Show>
          </button>
        </div>
      }
    >
      <div class="flex items-center justify-between gap-1 p-1.5 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {options.map((option) => {
          const Icon = option.icon;
          const isActive = theme() === option.value;
          return (
            <button
              onClick={() => setTheme(option.value)}
              class={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-white dark:bg-gray-700 text-text-primary shadow-sm ring-1 ring-gray-200 dark:ring-gray-600'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
              title={option.label}
            >
              <Icon class={`w-4 h-4 ${isActive ? 'text-blue-500' : ''}`} />
              <span class="hidden sm:inline">{option.label}</span>
            </button>
          );
        })}
      </div>
    </Show>
  );
}
