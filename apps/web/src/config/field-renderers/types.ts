/**
 * Field renderer types
 *
 * Defines the common interface for all field renderers.
 */

import type { JSX } from 'solid-js';
import type { FieldSchema, SelectOption } from '../schema';

/**
 * Props passed to all field renderers
 */
export type FieldRendererProps = {
  /** Current field value */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: unknown) => void;
  /** Field schema definition */
  schema: FieldSchema;
  /** Validation error message */
  error?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Dynamic options for select fields (updated by effects) */
  dynamicOptions?: SelectOption[];
};

/**
 * Field renderer function type
 *
 * All field renderers must conform to this interface,
 * enabling the registry pattern for extensibility.
 */
export type FieldRenderer = (props: FieldRendererProps) => JSX.Element;

/**
 * Context provided to field renderers
 *
 * This allows renderers to access form-level state and utilities.
 */
export type FieldRendererContext = {
  /** Get the current value of any field by path */
  getFieldValue: (path: string) => unknown;
  /** All current form values */
  formValues: Record<string, unknown>;
  /** Dynamic options map (keyed by field path) */
  dynamicOptions: Map<string, SelectOption[]>;
};
