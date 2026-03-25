/**
 * Number field renderer
 *
 * Renders numeric inputs with optional min/max/step constraints.
 */

import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';

export const NumberField: FieldRenderer = (props: FieldRendererProps) => {
  const value = () => {
    const v = props.value;
    return typeof v === 'number' ? v : '';
  };

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = target.valueAsNumber;
    if (!Number.isNaN(value)) {
      props.onChange(value);
    }
  };

  return (
    <div class="field-container mb-4">
      <FieldLabel schema={props.schema} error={props.error} />

      <input
        type="number"
        value={value()}
        onInput={handleChange}
        placeholder={props.schema.placeholder}
        disabled={props.disabled}
        min={props.schema.min}
        max={props.schema.max}
        step={props.schema.step ?? 1}
        class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
};
