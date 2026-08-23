/**
 * Loop-config validation shared by workflow_node_create and
 * workflow_node_update (and any future tool that accepts a LoopConfig
 * shape on the wire).
 *
 * Kept JSON-Schema-friendly: the helper accepts unknown and returns
 * `null` for OK / a string error message otherwise, matching the
 * requireString convention in `apps/server/src/tools/shared.ts`.
 */

const LOOP_CONDITION_OPERATORS = [
  'equals',
  'contains',
  'matches_regex',
] as const;

export type LoopConditionOperator = (typeof LOOP_CONDITION_OPERATORS)[number];

/**
 * Validate a loop payload from a tool argument.
 *
 * - `undefined` is OK when `allowUndefined` is true (means "do not
 *   change the loop"). When false, undefined is rejected so callers do
 *   not silently miss the field.
 * - `null` is OK in both modes — it means "explicitly clear the loop".
 *   (Only the update path uses this; create rejects null because there
 *   is nothing to clear on a brand-new node.)
 * - An object must have all three LoopConfig keys: maxIterations
 *   (number), conditionOperator (one of the three operator strings),
 *   and conditionValue (string).
 *
 * Returns `null` for OK, a string error message otherwise.
 */
export function validateLoopShape(
  loop: unknown,
  options: { allowUndefined: boolean; allowNull: boolean },
): string | null {
  if (loop === undefined) {
    return options.allowUndefined ? null : 'loop is required';
  }
  if (loop === null) {
    return options.allowNull ? null : 'loop cannot be null on create';
  }
  if (typeof loop !== 'object') {
    return 'loop must be an object or null';
  }
  const loopObj = loop as Record<string, unknown>;
  if (typeof loopObj['maxIterations'] !== 'number') {
    return 'loop.maxIterations is required and must be a number';
  }
  if (
    !LOOP_CONDITION_OPERATORS.includes(
      loopObj['conditionOperator'] as LoopConditionOperator,
    )
  ) {
    return `loop.conditionOperator must be one of: ${LOOP_CONDITION_OPERATORS.join(', ')}`;
  }
  if (typeof loopObj['conditionValue'] !== 'string') {
    return 'loop.conditionValue is required and must be a string';
  }
  return null;
}

/** Coerce a validated loop payload into the LoopConfig shape the service expects. */
export function loopShapeToConfig(loop: object): {
  maxIterations: number;
  conditionOperator: LoopConditionOperator;
  conditionValue: string;
} {
  const loopObj = loop as Record<string, unknown>;
  return {
    maxIterations: loopObj['maxIterations'] as number,
    conditionOperator: loopObj['conditionOperator'] as LoopConditionOperator,
    conditionValue: loopObj['conditionValue'] as string,
  };
}

export const LOOP_CONDITION_OPERATOR_VALUES = LOOP_CONDITION_OPERATORS;
