/**
 * Field label component
 *
 * Shared component used by all field renderers for consistent
 * labeling, descriptions, help text, and error display.
 */

import { Show, createSignal } from 'solid-js';
import { HelpCircle } from 'lucide-solid';
import type { FieldSchema } from '../schema';

export type FieldLabelProps = {
  schema: FieldSchema;
  error?: string;
};

export function FieldLabel(props: FieldLabelProps) {
  const [showHelp, setShowHelp] = createSignal(false);

  return (
    <div class="field-label-container">
      {/* Label row with required indicator and help button */}
      <div class="flex items-center gap-2 mb-1">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {props.schema.label}
          <Show when={props.schema.required}>
            <span class="text-red-500 ml-1">*</span>
          </Show>
        </label>

        {/* Help icon button for tooltip/popover */}
        <Show when={props.schema.helpText || props.schema.helpUrl}>
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp())}
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Toggle help"
          >
            <HelpCircle class="w-4 h-4" />
          </button>
        </Show>
      </div>

      {/* Short description below label */}
      <Show when={props.schema.description}>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {props.schema.description}
        </p>
      </Show>

      {/* Expandable help text */}
      <Show
        when={showHelp() && (props.schema.helpText || props.schema.helpUrl)}
      >
        <div class="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg mb-2 border border-gray-200 dark:border-gray-700">
          <Show when={props.schema.helpText}>
            <p class="mb-2">{props.schema.helpText}</p>
          </Show>
          <Show when={props.schema.helpUrl}>
            <a
              href={props.schema.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 text-sm inline-flex items-center gap-1"
            >
              Learn more
              <svg
                class="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </Show>
        </div>
      </Show>

      {/* Validation error */}
      <Show when={props.error}>
        <p class="text-xs text-red-500 dark:text-red-400 mt-1">{props.error}</p>
      </Show>
    </div>
  );
}
