import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import type { PlanningService } from '../../planning';
import { createTasksCreateTool } from './create';
import { createTasksUpdateTool } from './update';

export { createTasksCreateTool } from './create';
export { createTasksUpdateTool } from './update';

/**
 * Returns all task-related builtin tools.
 */
export function createTaskTools(
  getTaskService: () => TaskService | undefined,
  getPlanningService?: () => PlanningService | undefined,
): BuiltinTool[] {
  return [
    createTasksCreateTool(getTaskService),
    createTasksUpdateTool(getTaskService, getPlanningService),
  ];
}
