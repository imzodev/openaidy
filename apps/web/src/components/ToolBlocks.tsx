import { Show, createSignal } from 'solid-js';
import { ChevronDown, ChevronRight, Wrench, Server } from 'lucide-solid';

type ToolCallBlockProps = {
  name: string;
  input: Record<string, unknown>;
};

export function ToolCallBlock(props: ToolCallBlockProps) {
  const [open, setOpen] = createSignal(false);
  const isMcp = () => props.name.includes('::');
  const label = () => {
    if (isMcp()) {
      const [serverId, name] = props.name.split('::');
      return `${serverId} / ${name}`;
    }
    return props.name;
  };

  return (
    <div
      class={`mb-2 rounded border text-sm ${
        isMcp()
          ? 'border-purple-200 dark:border-purple-800'
          : 'border-yellow-200 dark:border-yellow-800'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-medium transition-colors ${
          isMcp()
            ? 'text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100'
            : 'text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100'
        }`}
      >
        <Show
          when={open()}
          fallback={<ChevronRight class="w-3 h-3 flex-shrink-0" />}
        >
          <ChevronDown class="w-3 h-3 flex-shrink-0" />
        </Show>
        {isMcp() ? (
          <Server class="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Wrench class="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span class="font-mono">{label()}</span>
      </button>
      <Show when={open()}>
        <div class="px-3 pb-3 pt-0">
          <pre class="text-xs overflow-x-auto text-text-secondary">
            {JSON.stringify(props.input, null, 2)}
          </pre>
        </div>
      </Show>
    </div>
  );
}

type ToolResultBlockProps = {
  content: string;
  isMcp: boolean;
};

export function ToolResultBlock(props: ToolResultBlockProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <div
      class={`rounded border text-sm ${
        props.isMcp
          ? 'border-purple-200 dark:border-purple-800'
          : 'border-yellow-200 dark:border-yellow-800'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-medium transition-colors ${
          props.isMcp
            ? 'text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100'
            : 'text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100'
        }`}
      >
        <Show
          when={open()}
          fallback={<ChevronRight class="w-3 h-3 flex-shrink-0" />}
        >
          <ChevronDown class="w-3 h-3 flex-shrink-0" />
        </Show>
        <span class="text-xs">result</span>
      </button>
      <Show when={open()}>
        <div class="px-3 pb-3 pt-0">
          <pre class="text-xs overflow-x-auto text-text-secondary whitespace-pre-wrap">
            {props.content}
          </pre>
        </div>
      </Show>
    </div>
  );
}
