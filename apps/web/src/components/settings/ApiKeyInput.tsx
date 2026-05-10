import { createSignal, Show } from 'solid-js';
import { Eye, EyeOff } from 'lucide-solid';

interface ApiKeyInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  error?: string;
}

export function ApiKeyInput(props: ApiKeyInputProps) {
  const [showKey, setShowKey] = createSignal(false);

  return (
    <div class="space-y-1">
      <div class="relative">
        <input
          type={showKey() ? 'text' : 'password'}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          placeholder={props.placeholder || 'API Key'}
          class="w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey())}
          class="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
        >
          <Show when={showKey()} fallback={<EyeOff class="w-4 h-4" />}>
            <Eye class="w-4 h-4" />
          </Show>
        </button>
      </div>
      <Show when={props.error}>
        <span class="text-xs text-red-500">{props.error}</span>
      </Show>
    </div>
  );
}
