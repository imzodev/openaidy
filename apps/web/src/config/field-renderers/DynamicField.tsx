/**
 * Dynamic field renderer
 *
 * Renders any field type based on the schema, delegating to the
 * appropriate specialized renderer via the registry.
 */

import type { FieldSchema, SelectOption } from '../schema';
import type { FieldRendererRegistry } from './registry';
import type { FieldRendererProps, FieldRenderer } from './types';
import { getDefaultRegistry } from './registry';

export type DynamicFieldProps = {
  schema: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  error?: string;
  errors?: Record<string, string>;
  errorPath?: string;
  dynamicOptions?: SelectOption[];
  registry?: FieldRendererRegistry;
};

/**
 * Dynamic field component that renders the appropriate field type
 * based on the schema definition.
 */
export function DynamicField(props: DynamicFieldProps) {
  // Get the error for this field from the errors map
  const fieldError = (): string | undefined => {
    if (props.error) return props.error;
    if (props.errorPath && props.errors) {
      return props.errors[props.errorPath];
    }
    return undefined;
  };

  // Get the appropriate renderer for this field type
  const renderer = (): FieldRenderer | undefined => {
    const registry = props.registry ?? getDefaultRegistry();
    return registry.get(props.schema.type);
  };

  // Create props for the renderer
  const rendererProps = (): FieldRendererProps => ({
    value: props.value,
    onChange: props.onChange,
    schema: props.schema,
    error: fieldError(),
    disabled: props.disabled,
    dynamicOptions: props.dynamicOptions,
  });

  const renderField = () => {
    const r = renderer();
    if (!r) {
      return (
        <div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-300 text-sm">
          Unknown field type: <code class="font-mono">{props.schema.type}</code>
        </div>
      );
    }
    return r(rendererProps());
  };

  return <>{renderField()}</>;
}
