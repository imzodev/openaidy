import type { BuiltinTool } from '@openaidy/runtime';
import { createTaskSchedulesListTool } from './list.js';
import { createTaskSchedulesCreateTool } from './create.js';
import { createTaskSchedulesUpdateTool } from './update.js';
import { createTaskSchedulesDeleteTool } from './delete.js';
import { createTaskSchedulesPauseTool } from './pause.js';
import { createTaskSchedulesResumeTool } from './resume.js';
import { createTaskSchedulesTriggerTool } from './trigger.js';
import { createTaskSchedulesListExecutionsTool } from './executions.js';
import type { TaskScheduleToolDeps } from './types.js';

export { createTaskSchedulesListTool } from './list.js';
export { createTaskSchedulesCreateTool } from './create.js';
export { createTaskSchedulesUpdateTool } from './update.js';
export { createTaskSchedulesDeleteTool } from './delete.js';
export { createTaskSchedulesPauseTool } from './pause.js';
export { createTaskSchedulesResumeTool } from './resume.js';
export { createTaskSchedulesTriggerTool } from './trigger.js';
export { createTaskSchedulesListExecutionsTool } from './executions.js';

export type { TaskScheduleToolDeps } from './types.js';

/**
 * Returns all task-schedule-related builtin tools.
 *
 * Eight tools:
 * - list            — read the schedule for a task (1:1)
 * - create          — attach a schedule to a task
 * - update          — patch fields (replan policy, max-executions, status, schedule)
 * - pause           — pause a schedule (preserves row and history)
 * - resume          — resume a paused schedule
 * - delete          — remove the schedule (with confirm=true safety interlock)
 * - trigger         — force an immediate run
 * - list_executions — paginated history of past runs
 */
export function createTaskScheduleTools(
  deps: TaskScheduleToolDeps,
): BuiltinTool[] {
  return [
    createTaskSchedulesListTool(deps),
    createTaskSchedulesCreateTool(deps),
    createTaskSchedulesUpdateTool(deps),
    createTaskSchedulesPauseTool(deps),
    createTaskSchedulesResumeTool(deps),
    createTaskSchedulesDeleteTool(deps),
    createTaskSchedulesTriggerTool(deps),
    createTaskSchedulesListExecutionsTool(deps),
  ];
}
