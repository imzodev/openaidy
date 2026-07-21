import { Show, createSignal } from 'solid-js';
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  Server,
  Loader,
  CircleStop,
  Ban,
} from 'lucide-solid';

type ToolCallBlockProps = {
  name: string;
  input: Record<string, unknown>;
  isActive?: boolean;
  /** Live stdout/stderr streamed while the tool runs. */
  output?: string;
  /** True once the user cancelled this tool call. */
  cancelled?: boolean;
  /** Invoked when the user clicks Stop; omit to hide the button. */
  onStop?: () => void;
};

export function ToolCallBlock(props: ToolCallBlockProps) {
  const [open, setOpen] = createSignal(false);
  const safeName = () => props.name ?? '';
  const isMcp = () => safeName().includes('::');
  const label = () => {
    if (isMcp()) {
      const [serverId, name] = safeName().split('::');
      return `${serverId} / ${name}`;
    }
    return safeName() || 'tool';
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
          when={!props.isActive}
          fallback={<Loader class="w-3 h-3 flex-shrink-0 animate-spin" />}
        >
          <Show
            when={open()}
            fallback={<ChevronRight class="w-3 h-3 flex-shrink-0" />}
          >
            <ChevronDown class="w-3 h-3 flex-shrink-0" />
          </Show>
        </Show>
        {isMcp() ? (
          <Server class="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Wrench class="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span class="font-mono">{label()}</span>
        <Show when={props.isActive}>
          <span class="ml-auto text-xs opacity-60">running...</span>
        </Show>
        <Show when={props.cancelled}>
          <span class="ml-auto inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <Ban class="w-3 h-3" />
            Cancelled by user
          </span>
        </Show>
      </button>

      {/* Stop control — only while the tool is actively running */}
      <Show when={props.isActive && props.onStop}>
        <div class="px-3 pb-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onStop?.();
            }}
            class="inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-800 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <CircleStop class="w-3.5 h-3.5" />
            Stop
          </button>
        </div>
      </Show>

      {/* Live output — streamed while running, and kept visible after. */}
      <Show when={props.output}>
        <div class="px-3 pb-2 pt-0">
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/5 dark:bg-white/5 p-2 text-xs text-text-secondary">
            {props.output}
          </pre>
        </div>
      </Show>

      <Show when={open() && !props.isActive}>
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
