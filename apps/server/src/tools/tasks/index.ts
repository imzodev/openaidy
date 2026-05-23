import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { createTasksCreateTool } from './create';

export { createTasksCreateTool } from './create';

/**
 * Returns all task-related builtin tools.
 */
export function createTaskTools(
  getTaskService: () => TaskService | undefined,
): BuiltinTool[] {
  return [createTasksCreateTool(getTaskService)];
}
