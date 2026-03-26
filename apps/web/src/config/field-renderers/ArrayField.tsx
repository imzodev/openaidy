/**
 * Array field renderer
 *
 * Renders a list of items with add/remove/reorder functionality.
 * Each item is rendered using the itemSchema.
 */

import { Show, For } from 'solid-js';
import { Plus } from 'lucide-solid';
import type { FieldRendererProps, FieldRenderer } from './types';
import { getDefaultRegistry } from './registry';

export const ArrayField: FieldRenderer = (props: FieldRendererProps) => {
  const items = () => (props.value as unknown[]) ?? [];
  const itemSchema = () => props.schema.itemSchema;
  const maxItems = () => props.schema.maxItems ?? Infinity;

  const canAdd = () => items().length < maxItems();

  const handleAdd = () => {
    if (!canAdd() || !itemSchema()) return;

    const newItem =
      itemSchema()!.defaultValue ?? getDefaultValue(itemSchema()!.type);
    props.onChange([...items(), newItem]);
  };

  const handleItemChange = (index: number, value: unknown) => {
    const newItems = [...items()];
    newItems[index] = value;
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
      {/* Array label removed - redundant with section header */}

      <div class="space-y-3">
        <For each={items()}>
          {(item, index) => (
            <div>
              {/* Item content */}
              <Show when={itemSchema()}>
                {(schema) => renderItem(index(), item, schema())}
              </Show>
            </div>
          )}
        </For>

        {/* Add button */}
        <Show when={canAdd()}>
          <button
            type="button"
            onClick={handleAdd}
            disabled={props.disabled}
            class="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus class="w-4 h-4" />
            Add {props.schema.label?.toLowerCase() ?? 'item'}
          </button>
        </Show>

        {/* Item count hint */}
        <Show when={maxItems() < Infinity}>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Maximum: {maxItems()} items
          </p>
        </Show>
      </div>
    </div>
  );
};

/**
 * Get default value for a field type
 */
function getDefaultValue(type: string): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}
