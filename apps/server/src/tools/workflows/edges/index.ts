import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import { createWorkflowEdgeCreateTool } from './create.js';
import { createWorkflowEdgeDeleteTool } from './delete.js';
import { createWorkflowEdgeUpdateTool } from './update.js';

export { createWorkflowEdgeCreateTool } from './create.js';
export { createWorkflowEdgeDeleteTool } from './delete.js';
export { createWorkflowEdgeUpdateTool } from './update.js';

/**
 * workflow_edge_* tools — CRUD on the directed dependency edges
 * between nodes inside a workflow.
 *
 * Every tool validates that the edge's source subtask belongs to a
 * workflow (planningEnabled=true) via the shared assertWorkflow guard.
 */
export function createWorkflowEdgeTools(
  getTaskService: () => TaskService | undefined,
): BuiltinTool[] {
  return [
    createWorkflowEdgeCreateTool(getTaskService),
    createWorkflowEdgeUpdateTool(getTaskService),
    createWorkflowEdgeDeleteTool(getTaskService),
  ];
}
