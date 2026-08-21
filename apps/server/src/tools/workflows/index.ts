import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { createWorkflowApplyTemplateTool } from './apply-template.js';
import { createWorkflowCreateTool } from './create.js';
import { createWorkflowDeleteTool } from './delete.js';
import { createWorkflowExecuteTool } from './execute.js';
import { createWorkflowGetTool } from './get.js';
import { createWorkflowListTool } from './list.js';
import { createWorkflowUpdateTool } from './update.js';

export { createWorkflowApplyTemplateTool } from './apply-template.js';
export { createWorkflowCreateTool } from './create.js';
export { createWorkflowDeleteTool } from './delete.js';
export { createWorkflowExecuteTool } from './execute.js';
export { createWorkflowGetTool } from './get.js';
export { createWorkflowListTool } from './list.js';
export { createWorkflowUpdateTool } from './update.js';

/**
 * Returns the workflow management agent tools.
 *
 * Every tool in this category operates on a workflow (a Task with
 * `planningEnabled: true`) and delegates to `TaskService` — there is no
 * separate workflow service to wire. The lazy getter matches the rest of
 * the builtin-tool registry so the tools degrade gracefully when the
 * database is not configured.
 */
export function createWorkflowTools(
  getTaskService: () => TaskService | undefined,
): BuiltinTool[] {
  return [
    createWorkflowGetTool(getTaskService),
    createWorkflowListTool(getTaskService),
    createWorkflowCreateTool(getTaskService),
    createWorkflowUpdateTool(getTaskService),
    createWorkflowDeleteTool(getTaskService),
    createWorkflowExecuteTool(getTaskService),
    createWorkflowApplyTemplateTool(getTaskService),
  ];
}
