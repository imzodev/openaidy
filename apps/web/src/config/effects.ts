/**
 * Field effects processor
 *
 * Processes field effects when a value changes, enabling reactive
 * form behavior where changing one field automatically updates others.
 */

import type { FieldSchema, SelectOption } from './schema';

/**
 * Set a nested value in an object using dot notation
 *
 * @param obj - The object to modify
 * @param path - Dot notation path (e.g., "defaults.providerId")
 * @param value - The value to set
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Result of processing field effects
 */
export type EffectsResult = {
  /** Config updates to apply */
  configUpdates: Partial<Record<string, unknown>>;
  /** Options updates for select fields */
  optionsUpdates: Map<string, SelectOption[]>;
  /** Fields that need re-validation */
  fieldsToValidate: string[];
};

/**
 * Process field effects when a field value changes
 *
 * @param changedField - The key of the field that changed
 * @param newValue - The new value of the field
 * @param currentConfig - The current form configuration
 * @param fieldSchemas - Map of field keys to their schemas
 * @returns Effects result with updates to apply
 */
export function processFieldEffects(
  changedField: string,
  newValue: unknown,
  currentConfig: Record<string, unknown>,
  fieldSchemas: Record<string, FieldSchema>,
): EffectsResult {
  const result: EffectsResult = {
    configUpdates: {},
    optionsUpdates: new Map(),
    fieldsToValidate: [],
  };

  const schema = fieldSchemas[changedField];
  if (!schema?.effects) {
    return result;
  }

  for (const effect of schema.effects) {
    switch (effect.type) {
      case 'setValue': {
        const value =
          typeof effect.value === 'function'
            ? effect.value(newValue, currentConfig)
            : effect.value;
        setNestedValue(result.configUpdates, effect.target, value);
        break;
      }

      case 'clearValue': {
        setNestedValue(result.configUpdates, effect.target, undefined);
        break;
      }

      case 'resetToDefault': {
        const targetSchema = fieldSchemas[effect.target];
        if (targetSchema?.defaultValue !== undefined) {
          setNestedValue(
            result.configUpdates,
            effect.target,
            targetSchema.defaultValue,
          );
        }
        break;
      }

      case 'updateOptions': {
        const options =
          typeof effect.options === 'function'
            ? effect.options(currentConfig)
            : effect.options;
        result.optionsUpdates.set(effect.target, options);
        break;
      }

      case 'validate': {
        result.fieldsToValidate.push(...effect.targets);
        break;
      }
    }
  }

  return result;
}

/**
 * Merge config updates into the current config
 *
 * @param config - The current configuration
 * @param updates - The updates to apply
 * @returns A new configuration object with updates applied
 */
export function applyConfigUpdates(
  config: Record<string, unknown>,
  updates: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  const result = { ...config };

  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('.');
    let current = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      } else {
        current[part] = { ...(current[part] as Record<string, unknown>) };
      }
      current = current[part] as Record<string, unknown>;
    }

    if (value === undefined) {
      delete current[parts[parts.length - 1]];
    } else {
      current[parts[parts.length - 1]] = value;
    }
  }

  return result;
}
