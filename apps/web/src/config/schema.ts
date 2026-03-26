/**
 * Schema types for dynamic form generation
 *
 * These types define the structure of form fields and enable
 * dynamic rendering of configuration forms based on schema metadata.
 */

/**
 * Supported field types for the dynamic form
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'array'
  | 'object'
  | 'discriminated-union';

/**
 * Select option definition
 */
export type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

/**
 * Conditional visibility - field is shown only when condition is met
 *
 * Examples:
 * - Show apiKeyEnv only when enabled is true
 * - Show anthropic-specific fields only when vendorFamily is anthropic
 */
export type VisibilityCondition =
  | { field: string; equals: unknown }
  | { field: string; notEquals: unknown }
  | { field: string; in: unknown[] }
  | { field: string; notIn: unknown[] }
  | { field: string; exists: boolean }
  | { all: VisibilityCondition[] } // AND - all conditions must be true
  | { any: VisibilityCondition[] } // OR - at least one condition must be true
  | { not: VisibilityCondition }; // NOT - negate the condition

/**
 * Field effects - actions to perform when a field value changes
 *
 * This enables reactive form behavior where changing one field
 * automatically updates other fields.
 */
export type FieldEffect =
  | {
      type: 'setValue';
      target: string;
      value:
        | unknown
        | ((current: unknown, formValues: Record<string, unknown>) => unknown);
    }
  | { type: 'clearValue'; target: string }
  | { type: 'resetToDefault'; target: string }
  | {
      type: 'updateOptions';
      target: string;
      options:
        | SelectOption[]
        | ((formValues: Record<string, unknown>) => SelectOption[]);
    }
  | { type: 'validate'; targets: string[] };

/**
 * Field schema definition
 *
 * Describes a single form field including its type, label,
 * validation rules, and conditional behavior.
 */
export type FieldSchema = {
  type: FieldType;
  key: string;
  label: string;
  required?: boolean;
  defaultValue?: unknown;

  // Help and documentation
  description?: string; // Short description shown below label
  helpText?: string; // Longer help text shown in tooltip/popover
  helpUrl?: string; // Link to external documentation
  placeholder?: string; // Placeholder text for input fields

  // For strings
  multiline?: boolean;

  // For numbers
  min?: number;
  max?: number;
  step?: number;

  // For selects
  options?: SelectOption[];
  optionsSource?: 'providers' | 'agents' | 'models';

  // For arrays
  itemSchema?: FieldSchema;
  minItems?: number;
  maxItems?: number;

  // For objects
  properties?: Record<string, FieldSchema>;

  // For discriminated unions
  discriminator?: string;
  variantSchemas?: Record<string, Record<string, FieldSchema>>;

  // Conditional visibility
  visibleWhen?: VisibilityCondition;

  // Field dependencies - actions to take when this field changes
  effects?: FieldEffect[];
};

/**
 * Section schema definition
 *
 * Groups related fields together with a title and optional description.
 */
export type SectionSchema = {
  id: string;
  title?: string;
  description?: string;
  fields: FieldSchema[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

/**
 * Complete form schema
 *
 * Defines the entire form structure with sections and field schemas.
 */
export type FormSchema = {
  sections: SectionSchema[];
};
