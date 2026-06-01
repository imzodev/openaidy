import type { BuiltinTool } from '@openaidy/runtime';
import { createPulsesListTool } from './list.js';
import { createPulsesCreateTool } from './create.js';
import { createPulsesUpdateTool } from './update.js';
import { createPulsesDeleteTool } from './delete.js';
import type { PulseToolDeps } from './types.js';

export { createPulsesCreateTool } from './create.js';
export { createPulsesListTool } from './list.js';
export { createPulsesUpdateTool } from './update.js';
export { createPulsesDeleteTool } from './delete.js';

export type { PulseToolDeps } from './types.js';

/**
 * Returns all pulse-related builtin tools.
 */
export function createPulseTools(deps: PulseToolDeps): BuiltinTool[] {
  return [
    createPulsesListTool(deps),
    createPulsesCreateTool(deps),
    createPulsesUpdateTool(deps),
    createPulsesDeleteTool(deps),
  ];
}
