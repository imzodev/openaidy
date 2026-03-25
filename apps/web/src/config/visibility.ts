/**
 * Visibility condition evaluation
 *
 * Evaluates conditional visibility rules against current form values
 * to determine which fields should be shown or hidden.
 */

import type { VisibilityCondition } from './schema';

/**
 * Get a nested field value using dot notation path
 *
 * @param values - The form values object
 * @param path - Dot notation path (e.g., "defaults.providerId")
 * @returns The value at the path, or undefined if not found
 */
function getFieldValue(values: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = values;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a visibility condition against form values
 *
 * @param condition - The visibility condition to evaluate
 * @param values - The current form values
 * @returns true if the condition is met (field should be visible), false otherwise
 */
export function evaluateVisibility(
  condition: VisibilityCondition,
  values: Record<string, unknown>,
): boolean {
  if ('equals' in condition) {
    return getFieldValue(values, condition.field) === condition.equals;
  }

  if ('notEquals' in condition) {
    return getFieldValue(values, condition.field) !== condition.notEquals;
  }

  if ('in' in condition) {
    const value = getFieldValue(values, condition.field);
    return condition.in.includes(value);
  }

  if ('notIn' in condition) {
    const value = getFieldValue(values, condition.field);
    return !condition.notIn.includes(value);
  }

  if ('exists' in condition) {
    const value = getFieldValue(values, condition.field);
    return condition.exists ? value !== undefined : value === undefined;
  }

  if ('all' in condition) {
    return condition.all.every((c) => evaluateVisibility(c, values));
  }

  if ('any' in condition) {
    return condition.any.some((c) => evaluateVisibility(c, values));
  }

  if ('not' in condition) {
    return !evaluateVisibility(condition.not, values);
  }

  // Unknown condition type - default to visible
  return true;
}

/**
 * Check if a field should be visible based on its visibility condition
 *
 * @param visibleWhen - The visibility condition (or undefined for always visible)
 * @param values - The current form values
 * @returns true if the field should be visible
 */
export function isFieldVisible(
  visibleWhen: VisibilityCondition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!visibleWhen) {
    return true;
  }
  return evaluateVisibility(visibleWhen, values);
}
