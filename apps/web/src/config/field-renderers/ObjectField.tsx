/**
 * Object field renderer
 *
 * Renders an object with nested fields based on the properties schema.
 * Supports recursive rendering of nested objects and arrays.
 */

import { Show, For } from 'solid-js';
import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';
import { getDefaultRegistry } from './registry';

export const ObjectField: FieldRenderer = (props: FieldRendererProps) => {
  const objectValue = () =>
    (props.value as Record<string, unknown> | undefined) ?? {};
  const properties = () => props.schema.properties ?? {};
  const propertyKeys = () => Object.keys(properties());

  const handlePropertyChange = (key: string, newValue: unknown) => {
    props.onChange({
      ...objectValue(),
      [key]: newValue,
    });
  };

  // Render a nested field using the registry
  const renderNestedField = (
    key: string,
    schema: NonNullable<ReturnType<typeof properties>[string]>,
    value: unknown,
  ) => {
    const registry = getDefaultRegistry();
    const renderer = registry.get(schema.type);

    if (!renderer) {
      return (
        <div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-300 text-sm">
          Unknown field type: <code class="font-mono">{schema.type}</code>
        </div>
      );
    }

    return renderer({
      value,
      onChange: (val: unknown) => handlePropertyChange(key, val),
      schema,
      disabled: props.disabled,
    });
  };

  return (
    <div class="field-container mb-4">
      <FieldLabel schema={props.schema} error={props.error} />

      <div class="space-y-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
        <For each={propertyKeys()}>
          {(key) => {
            const propSchema = () => properties()[key];
            const propValue = () => objectValue()[key];

            return (
              <Show when={propSchema()}>
                {renderNestedField(key, propSchema()!, propValue())}
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
};
