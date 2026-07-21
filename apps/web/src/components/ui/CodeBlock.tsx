import { Show } from 'solid-js';
import { CopyButton } from './CopyButton';

export type CodeBlockProps = {
  code: string;
  language?: string;
};

/**
 * CodeBlock
 *
 * Renders a fenced code snippet with a copy-to-clipboard affordance in the
 * top-right corner. The button copies only the code body, never the language
 * label.
 */
export function CodeBlock(props: CodeBlockProps) {
  return (
    <div class="relative group my-2">
      <div class="absolute top-2 right-2 z-10">
        <CopyButton text={props.code} label="Copy code" />
      </div>
      <Show when={props.language}>
        <div class="absolute top-2 left-2 z-10 text-[10px] uppercase tracking-wide text-text-tertiary bg-black/5 dark:bg-white/10 rounded px-1.5 py-0.5 pointer-events-none">
          {props.language}
        </div>
      </Show>
      <pre class="bg-gray-900 text-gray-100 dark:bg-gray-950 rounded-md p-3 pt-7 overflow-x-auto text-sm">
        <code class={`language-${props.language ?? 'text'}`}>{props.code}</code>
      </pre>
    </div>
  );
}
