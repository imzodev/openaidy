import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service.js';
import { createSubtaskCompleteTool } from './complete.js';

export { createSubtaskCompleteTool } from './complete.js';

export type TasksToolDeps = {
  getTaskService: () => TaskService;
};

export function createTasksTools(deps: TasksToolDeps): BuiltinTool[] {
  return [createSubtaskCompleteTool(deps)];
}
