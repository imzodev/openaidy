/**
 * Config module index
 *
 * Public exports for the dynamic configuration form system.
 */

// Schema types
export type {
  FieldType,
  FieldSchema,
  SectionSchema,
  FormSchema,
  SelectOption,
  VisibilityCondition,
  FieldEffect,
} from './schema';

// Visibility utilities
export { evaluateVisibility, isFieldVisible } from './visibility';

// Effects utilities
export { processFieldEffects, applyConfigUpdates } from './effects';
export type { EffectsResult } from './effects';

// Field renderers
export {
  // Types
  type FieldRendererProps,
  type FieldRenderer,
  type FieldRendererRegistry,
  // Components
  FieldLabel,
  TextField,
  NumberField,
  BooleanField,
  SelectField,
  ArrayField,
  ObjectField,
  DynamicField,
  type DynamicFieldProps,
  // Registry
  createFieldRendererRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
  registerStandardRenderers,
} from './field-renderers';

// Dynamic form component
export { DynamicConfigForm } from './DynamicConfigForm';
export type { DynamicConfigFormProps } from './DynamicConfigForm';

// Schema builders
export {
  getDefaultsSectionSchema,
  getProvidersSectionSchema,
  getProvidersSectionSchemaWithModels,
  getVendorSpecificFields,
  getAgentsSectionSchema,
  getExecutionSectionSchema,
  buildAppConfigSchema,
} from './schemas';
export type { BuildFormSchemaOptions } from './schemas';
