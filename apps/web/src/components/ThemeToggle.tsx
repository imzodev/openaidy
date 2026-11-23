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
            class="p-2 rounded-md text-text-tertiary hover:bg-fill hover:text-text-primary transition-colors"
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
      <div
        role="radiogroup"
        aria-label="Appearance"
        class="flex items-center gap-0.5 p-0.5 bg-fill rounded-lg"
      >
        {options.map((option) => {
          const Icon = option.icon;
          const isActive = theme() === option.value;
          return (
            <button
              onClick={() => setTheme(option.value)}
              role="radio"
              aria-checked={isActive}
              class={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-xs font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-white dark:bg-gray-600 text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
              title={option.label}
            >
              <Icon class="w-3.5 h-3.5" stroke-width={2} />
              <span class="hidden sm:inline">{option.label}</span>
            </button>
          );
        })}
      </div>
    </Show>
  );
}
