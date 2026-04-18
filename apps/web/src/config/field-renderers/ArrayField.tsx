/**
 * Array field renderer
 *
 * Renders a list of items with add/remove/reorder functionality.
 * Each item is rendered using the itemSchema.
 */

import { Show, For } from 'solid-js';
import { Plus, Trash2 } from 'lucide-solid';
import type { FieldRendererProps, FieldRenderer } from './types';
import type { FieldSchema } from '../schema';
import { getDefaultRegistry } from './registry';

function buildDefaultItem(schema: FieldSchema): unknown {
  if (schema.type === 'object' && schema.properties) {
    const obj: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.properties) as [
      string,
      FieldSchema,
    ][]) {
      if (field.defaultValue !== undefined) {
        obj[key] = field.defaultValue;
      }
    }
    return obj;
  }
  return schema.defaultValue ?? '';
}

export const ArrayField: FieldRenderer = (props: FieldRendererProps) => {
  const items = () => (props.value as unknown[]) ?? [];
  const itemSchema = () => props.schema.itemSchema;
  const maxItems = () => props.schema.maxItems ?? Infinity;
  const minItems = () => props.schema.minItems ?? 0;

  const handleItemChange = (index: number, value: unknown) => {
    const newItems = [...items()];
    newItems[index] = value;
    props.onChange(newItems);
  };

  const handleAddItem = () => {
    const schema = itemSchema();
    if (!schema || items().length >= maxItems()) return;
    props.onChange([...items(), buildDefaultItem(schema)]);
  };

  const handleRemoveItem = (index: number) => {
    if (items().length <= minItems()) return;
    const newItems = items().filter((_, i) => i !== index);
    props.onChange(newItems);
  };

  // Render an item using the registry
  const renderItem = (
    index: number,
    item: unknown,
    schema: NonNullable<ReturnType<typeof itemSchema>>,
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
      value: item,
      onChange: (val: unknown) => handleItemChange(index, val),
      schema,
      disabled: props.disabled,
    });
  };

  return (
    <div class="field-container mb-4">
      <div class="space-y-3">
        <For each={items()}>
          {(item, index) => (
            <div class="relative group border border-border rounded-lg p-3">
              <Show when={items().length > minItems() && !props.disabled}>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(index())}
                  class="absolute top-2 right-2 p-1 text-text-tertiary hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove item"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </Show>
              <Show when={itemSchema()}>
                {(schema) => renderItem(index(), item, schema())}
              </Show>
            </div>
          )}
        </For>

        <Show
          when={items().length < maxItems() && !props.disabled && itemSchema()}
        >
          <button
            type="button"
            onClick={handleAddItem}
            class="flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover transition-colors py-1"
          >
            <Plus class="w-4 h-4" />
            Add {props.schema.label}
          </button>
        </Show>

        <Show when={maxItems() < Infinity && maxItems() > 1}>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Maximum: {maxItems()} items
          </p>
        </Show>
      </div>
    </div>
  );
};
