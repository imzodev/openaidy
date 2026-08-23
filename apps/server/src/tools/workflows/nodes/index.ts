import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import { createWorkflowNodeCreateTool } from './create.js';
import { createWorkflowNodeDeleteTool } from './delete.js';
import { createWorkflowNodeUpdateTool } from './update.js';

export { createWorkflowNodeCreateTool } from './create.js';
export { createWorkflowNodeDeleteTool } from './delete.js';
export { createWorkflowNodeUpdateTool } from './update.js';

/**
 * workflow_node_* tools — CRUD on the nodes inside a workflow.
 *
 * Every tool validates that the parent task has planningEnabled=true
 * via the shared assertWorkflow guard, so the agent cannot mutate a
 * regular task through the workflow surface.
 */
export function createWorkflowNodeTools(
  getTaskService: () => TaskService | undefined,
): BuiltinTool[] {
  return [
    createWorkflowNodeCreateTool(getTaskService),
    createWorkflowNodeUpdateTool(getTaskService),
    createWorkflowNodeDeleteTool(getTaskService),
  ];
}
