/**
 * Dynamic config form component
 *
 * Main form component that renders sections and fields based on schema metadata.
 * Handles visibility conditions, field effects, and validation.
 */

import { Show, For, createSignal, createMemo } from 'solid-js';
import { ChevronDown, ChevronRight } from 'lucide-solid';
import type { SectionSchema, FieldSchema, FormSchema } from './schema';
import { isFieldVisible } from './visibility';
import { processFieldEffects, applyConfigUpdates } from './effects';
import { DynamicField } from './field-renderers';
import type { FieldRendererRegistry } from './field-renderers';

export type DynamicConfigFormProps = {
  /** Current configuration values */
  config: Record<string, unknown>;
  /** Form schema defining sections and fields */
  schema: FormSchema;
  /** Callback when configuration changes */
  onChange: (config: Record<string, unknown>) => void;
  /** Validation errors keyed by field path */
  errors?: Record<string, string>;
  /** Whether the form is disabled */
  disabled?: boolean;
  /** Custom field renderer registry (uses default if not provided) */
  registry?: FieldRendererRegistry;
};

/**
 * Dynamic configuration form component
 */
export function DynamicConfigForm(props: DynamicConfigFormProps) {
  // Track collapsed state of sections
  const [collapsedSections, setCollapsedSections] = createSignal<Set<string>>(
    new Set(),
  );

  // Get nested value from config using dot notation
  const getFieldValue = (path: string): unknown => {
    const parts = path.split('.');
    let current: unknown = props.config;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };

  // Handle field value change with effects processing
  const handleFieldChange = (fieldSchema: FieldSchema, newValue: unknown) => {
    // First, update the field value
    const path = fieldSchema.key;
    const updates: Record<string, unknown> = {};

    // Set nested value
    const parts = path.split('.');
    let current = updates;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = newValue;

    // Apply the value update
    let newConfig = applyConfigUpdates(props.config, updates);

    // Process field effects if any
    if (fieldSchema.effects) {
      // Build a map of field schemas for effect processing
      const fieldSchemas = buildFieldSchemaMap(props.schema);
      const effectsResult = processFieldEffects(
        fieldSchema.key,
        newValue,
        newConfig,
        fieldSchemas,
      );

      // Apply effect updates
      if (Object.keys(effectsResult.configUpdates).length > 0) {
        newConfig = applyConfigUpdates(newConfig, effectsResult.configUpdates);
      }
    }

    props.onChange(newConfig);
  };

  // Toggle section collapse
  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Check if a section is collapsed
  const isSectionCollapsed = (sectionId: string): boolean => {
    return collapsedSections().has(sectionId);
  };

  return (
    <div class="dynamic-config-form space-y-6">
      <For each={props.schema.sections}>
        {(section) => (
          <ConfigSection
            section={section}
            config={props.config}
            errors={props.errors}
            disabled={props.disabled}
            registry={props.registry}
            collapsed={isSectionCollapsed(section.id)}
            onToggleCollapse={() => toggleSection(section.id)}
            getFieldValue={getFieldValue}
            onFieldChange={handleFieldChange}
          />
        )}
      </For>
    </div>
  );
}

/**
 * Configuration section component
 */
type ConfigSectionProps = {
  section: SectionSchema;
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  disabled?: boolean;
  registry?: FieldRendererRegistry;
  collapsed: boolean;
  onToggleCollapse: () => void;
  getFieldValue: (path: string) => unknown;
  onFieldChange: (schema: FieldSchema, value: unknown) => void;
};

function ConfigSection(props: ConfigSectionProps) {
  const isCollapsible = () => props.section.collapsible ?? false;
  const showContent = () => !isCollapsible() || !props.collapsed;

  return (
    <div class="config-section bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      {/* Section header */}
      <div
        class={`flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 ${
          isCollapsible()
            ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50'
            : ''
        }`}
        onClick={isCollapsible() ? props.onToggleCollapse : undefined}
      >
        <div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
            {props.section.title}
          </h3>
          <Show when={props.section.description}>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {props.section.description}
            </p>
          </Show>
        </div>

        <Show when={isCollapsible()}>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label={props.collapsed ? 'Expand section' : 'Collapse section'}
          >
            <Show
              when={props.collapsed}
              fallback={<ChevronDown class="w-5 h-5" />}
            >
              <ChevronRight class="w-5 h-5" />
            </Show>
          </button>
        </Show>
      </div>

      {/* Section content */}
      <Show when={showContent()}>
        <div class="px-6 py-4 space-y-4">
          <For each={props.section.fields}>
            {(fieldSchema) => (
              <VisibleField
                schema={fieldSchema}
                config={props.config}
                errors={props.errors}
                disabled={props.disabled}
                registry={props.registry}
                getFieldValue={props.getFieldValue}
                onFieldChange={props.onFieldChange}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * Field wrapper that handles visibility conditions
 */
type VisibleFieldProps = {
  schema: FieldSchema;
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  disabled?: boolean;
  registry?: FieldRendererRegistry;
  getFieldValue: (path: string) => unknown;
  onFieldChange: (schema: FieldSchema, value: unknown) => void;
};

function VisibleField(props: VisibleFieldProps) {
  // Check visibility condition
  const isVisible = createMemo(() => {
    return isFieldVisible(props.schema.visibleWhen, props.config);
  });

  return (
    <Show when={isVisible()}>
      <DynamicField
        schema={props.schema}
        value={props.getFieldValue(props.schema.key)}
        onChange={(value) => props.onFieldChange(props.schema, value)}
        disabled={props.disabled}
        errors={props.errors}
        errorPath={props.schema.key}
        registry={props.registry}
      />
    </Show>
  );
}

/**
 * Build a flat map of field schemas from the form schema
 * Used for effect processing
 */
function buildFieldSchemaMap(schema: FormSchema): Record<string, FieldSchema> {
  const map: Record<string, FieldSchema> = {};

  function processField(field: FieldSchema, prefix = '') {
    const key = prefix ? `${prefix}.${field.key}` : field.key;
    map[key] = field;

    // Process nested properties
    if (field.properties) {
      for (const prop of Object.values(field.properties)) {
        processField(prop, key);
      }
    }

    // Process array item schema
    if (field.itemSchema) {
      processField(field.itemSchema, `${key}[]`);
    }

    // Process discriminated union variants
    if (field.variantSchemas) {
      for (const variantProps of Object.values(field.variantSchemas)) {
        for (const prop of Object.values(variantProps)) {
          processField(prop, key);
        }
      }
    }
  }

  for (const section of schema.sections) {
    for (const field of section.fields) {
      processField(field);
    }
  }

  return map;
}
