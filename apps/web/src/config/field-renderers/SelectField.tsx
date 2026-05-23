/**
 * Select field renderer
 *
 * Renders a dropdown select input with support for static options
 * and dynamically updated options from field effects.
 */

import { Show, For, createMemo } from 'solid-js';
import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';
import { useProviders } from './context';

export const SelectField: FieldRenderer = (props: FieldRendererProps) => {
  const value = () => (props.value as string | undefined) ?? '';
  const providers = useProviders();

  const options = createMemo(() => {
    if (providers && providers.length > 0) {
      const opts: Array<{
        value: string;
        label: string;
        description?: string;
      }> = [];
      for (const provider of providers) {
        for (const model of provider.models ?? []) {
          if (model.enabled !== false) {
            opts.push({
              value: `${provider.id}/${model.id}`,
              label: `${model.name ?? model.id} (${provider.name})`,
            });
          }
        }
      }
      return opts;
    }
    return props.schema.options ?? [];
  });

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement;
    props.onChange(target.value);
  };

  return (
    <div class="field-container mb-4">
      <FieldLabel schema={props.schema} error={props.error} />

      <select
        value={value()}
        onChange={handleChange}
        disabled={props.disabled}
        class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Show when={!props.schema.required || !value()}>
          <option value="" disabled={props.schema.required}>
            {props.schema.placeholder ?? 'Select an option...'}
          </option>
        </Show>

        <For each={options()}>
          {(option) => (
            <option value={option.value}>
              {option.label}
              <Show when={option.description}> - {option.description}</Show>
            </option>
          )}
        </For>
      </select>
    </div>
  );
};
