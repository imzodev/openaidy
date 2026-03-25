/**
 * Boolean field renderer
 *
 * Renders a checkbox toggle for boolean values.
 */

import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';

export const BooleanField: FieldRenderer = (props: FieldRendererProps) => {
  const checked = () => Boolean(props.value);

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    props.onChange(target.checked);
  };

  return (
    <div class="field-container mb-4">
      <div class="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked()}
          onChange={handleChange}
          disabled={props.disabled}
          class="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-blue-500 dark:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div class="flex-1">
          <FieldLabel schema={props.schema} error={props.error} />
        </div>
      </div>
    </div>
  );
};
