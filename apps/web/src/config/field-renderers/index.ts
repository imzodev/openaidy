/**
 * Field renderers index
 *
 * Exports all field renderers and provides a function to register
 * them with a registry.
 */

// Types
export type { FieldRendererProps, FieldRenderer } from './types';

// Registry
export {
  createFieldRendererRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
} from './registry';
export type { FieldRendererRegistry } from './registry';

// Components
export { FieldLabel } from './FieldLabel';
export { TextField } from './TextField';
export { NumberField } from './NumberField';
export { BooleanField } from './BooleanField';
export { SelectField } from './SelectField';
export { ArrayField } from './ArrayField';
export { ObjectField } from './ObjectField';
export { DynamicField } from './DynamicField';
export type { DynamicFieldProps } from './DynamicField';

// Standard renderers registration
import { TextField } from './TextField';
import { NumberField } from './NumberField';
import { BooleanField } from './BooleanField';
import { SelectField } from './SelectField';
import { ArrayField } from './ArrayField';
import { ObjectField } from './ObjectField';
import type { FieldRendererRegistry } from './registry';

/**
 * Register all standard field renderers with a registry
 */
export function registerStandardRenderers(
  registry: FieldRendererRegistry,
): void {
  registry.register('string', TextField);
  registry.register('number', NumberField);
  registry.register('boolean', BooleanField);
  registry.register('select', SelectField);
  registry.register('array', ArrayField);
  registry.register('object', ObjectField);
}

// Auto-register standard renderers with the default registry
import { getDefaultRegistry } from './registry';
registerStandardRenderers(getDefaultRegistry());
