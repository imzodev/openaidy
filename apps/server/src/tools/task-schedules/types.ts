import type { TaskScheduleService } from '../../tasks/schedule-service.js';

/**
 * Dependencies for task-schedule tools.
 *
 * `getTaskScheduleService` is the primary dependency. It returns the
 * service that the tools delegate to. The service is registered with
 * the BuiltinToolRegistry in `tools/index.ts` and constructed in
 * `app.ts` only when the database (and TaskService) is available.
 */
export type TaskScheduleToolDeps = {
  getTaskScheduleService: () => TaskScheduleService | undefined;
};
