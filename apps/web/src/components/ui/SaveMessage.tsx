import { Show } from 'solid-js';
import { AlertCircle, CheckCircle2 } from 'lucide-solid';

export type SaveMessageType = {
  type: 'success' | 'error';
  text: string;
} | null;

interface SaveMessageProps {
  message: () => SaveMessageType;
}

export function SaveMessage(props: SaveMessageProps) {
  return (
    <Show when={props.message()}>
      <div
        class={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
          props.message()?.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
        }`}
      >
        <Show
          when={props.message()?.type === 'success'}
          fallback={<AlertCircle class="w-5 h-5" />}
        >
          <CheckCircle2 class="w-5 h-5" />
        </Show>
        <p>{props.message()?.text}</p>
      </div>
    </Show>
  );
}
