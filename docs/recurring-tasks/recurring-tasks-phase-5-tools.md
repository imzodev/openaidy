# Phase 5: Built-in Tools

## Overview

Phase 5 exposes the schedule functionality to AI agents through the built-in tool registry. An agent can now read a task's schedule, attach a new schedule, pause/resume, trigger, and inspect execution history — all through the same `tasks_*` tool namespace they already use.

This is what makes recurring tasks usable from the chat UI: an agent can say "I'll run this task every hour from now on" and have it actually happen.

## Objectives

- Extend `tasks_create` to accept an optional `schedule` parameter
- Extend `tasks_update` to accept optional schedule parameters (and `schedule: null` to remove)
- Extend `tasks_list` to include the `schedule` field in the response
- Add `tasks_pause_schedule` tool
- Add `tasks_resume_schedule` tool
- Add `tasks_trigger_now` tool (forces an immediate run)
- Add `tasks_list_executions` tool
- Add all new `ToolMeta` entries to `ALL_TOOL_METAS` in `catalog.ts`
- Follow the existing tool naming conventions (snake_case, no abbreviations)
- Add tool tests with mocked services

## Success criteria

- All 6 tools are registered in the catalog
- An agent can call `tasks_create` with a `schedule` parameter and the result includes the schedule
- An agent can call `tasks_update` with `schedule: null` to remove the schedule
- An agent can call `tasks_pause_schedule` to suspend a recurring task
- An agent can call `tasks_list_executions` and get a paginated history
- Tool descriptions are clear and self-explanatory
- All tools have input validation via Zod
- All tools return the standard `ServiceResult` shape

---

## Implementation tasks

### 1. Update `tasks_list` to include the `schedule` field

**Update: `apps/server/src/tools/tasks/list.ts`**

```ts
export const tasksListMeta: ToolMeta = {
  name: 'tasks_list',
  category: 'Tasks',
  description:
    'List all tasks. Each task includes its schedule (nextRunAt, lastRunAt, executionCount, status) ' +
    'when a schedule is attached. Use this to discover recurring tasks and their current state.',
};

export async function tasksListTool(
  args: { status?: TaskStatus },
  ctx: { taskService: TaskService },
): Promise<ServiceResult<TaskWithDetails[]>> {
  const tasks = await ctx.taskService.listTasks(args.status);
  // Augment with schedule (already done in TaskService.listTasksForKanban;
  // we replicate the lookup here for the non-kanban endpoint)
  const withSchedules = await Promise.all(
    tasks.map(async (task) => {
      const details = await ctx.taskService.getTaskWithDetails(task.id);
      return details ?? task;
    }),
  );
  return { ok: true, data: withSchedules };
}
```

### 2. Update `tasks_create` to accept `schedule`

**Update: `apps/server/src/tools/tasks/create.ts`**

```ts
import type { CreateTaskScheduleInput } from '@openaidy/shared-types';

export const tasksCreateMeta: ToolMeta = {
  name: 'tasks_create',
  category: 'Tasks',
  description:
    'Create a new task. Optionally attach a schedule (recurring or one-shot) using the same ' +
    'human-friendly schedule formats as pulses: { every: "1h" }, { daily: { hour: 9, minute: 0 } }, ' +
    '{ cron: "0 9 * * 1-5" }, or { at: "2026-12-31T23:59:00Z" }. ' +
    'When a schedule is attached, the task re-runs on every tick with full planning + subtask lifecycle. ' +
    'Returns the created task including the schedule.',
};

export const tasksCreateInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  planningEnabled: z.boolean().optional(),
  schedule: z
    .object({
      schedule: z.union([
        z.object({
          every: z.enum(['15m', '30m', '1h', '6h', '12h', '1d', '1w']),
        }),
        z.object({
          daily: z.object({
            hour: z.number().int().min(0).max(23),
            minute: z.number().int().min(0).max(59),
          }),
        }),
        z.object({ cron: z.string().min(1), tz: z.string().optional() }),
        z.object({ at: z.string().datetime() }),
      ]),
      maxExecutions: z.number().int().positive().optional(), // positive integer; defaults to 9999, no null
      replanPolicy: z
        .enum(['never', 'on-description-change', 'always'])
        .optional(),
    })
    .optional(),
});

export async function tasksCreateTool(
  args: z.infer<typeof tasksCreateInputSchema>,
  ctx: { taskService: TaskService },
): Promise<ServiceResult<TaskWithDetails>> {
  const createInput: CreateTaskInput = {
    title: args.title,
    description: args.description,
    ...(args.priority !== undefined ? { priority: args.priority } : {}),
    ...(args.planningEnabled !== undefined
      ? { planningEnabled: args.planningEnabled }
      : {}),
    ...(args.schedule
      ? {
          schedule: {
            schedule: args.schedule
              .schedule as CreateTaskScheduleInput['schedule'],
            ...(args.schedule.maxExecutions !== undefined
              ? { maxExecutions: args.schedule.maxExecutions }
              : {}),
            ...(args.schedule.replanPolicy !== undefined
              ? { replanPolicy: args.schedule.replanPolicy }
              : {}),
          },
        }
      : {}),
  };
  const result = await ctx.taskService.createTask(createInput);
  if (!result.ok) return { ok: false, error: result.error };
  const details = await ctx.taskService.getTaskWithDetails(result.data.id);
  return { ok: true, data: details ?? result.data };
}
```

### 3. Update `tasks_update` to accept schedule changes

**Update: `apps/server/src/tools/tasks/update.ts`**

```ts
export const tasksUpdateMeta: ToolMeta = {
  name: 'tasks_update',
  category: 'Tasks',
  description:
    'Update a task. Pass schedule={...} to add or change a schedule. Pass schedule=null to remove it. ' +
    'Pass maxExecutions (positive integer; defaults to 9999) to change the cap. ' +
    'Pass replanPolicy ("never" | "on-description-change" | "always") to control re-planning on each run. ' +
    'The default replanPolicy is "never" — subtasks are reused on every run.',
};

export const tasksUpdateInputSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(10_000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z
    .enum(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'])
    .optional(),
  // Pass a schedule object to add/update, or null to remove.
  schedule: z
    .union([
      z.object({
        schedule: z.union([
          z.object({
            every: z.enum(['15m', '30m', '1h', '6h', '12h', '1d', '1w']),
          }),
          z.object({
            daily: z.object({
              hour: z.number().int().min(0).max(23),
              minute: z.number().int().min(0).max(59),
            }),
          }),
          z.object({ cron: z.string().min(1), tz: z.string().optional() }),
          z.object({ at: z.string().datetime() }),
        ]),
        maxExecutions: z.number().int().positive().optional(), // positive integer; no null
      }),
      z.null(),
    ])
    .optional(),
});
```

Implementation handles the two cases (add/update vs remove) by branching on `args.schedule === null`.

### 4. Add `tasks_pause_schedule`

**New file: `apps/server/src/tools/tasks/pause-schedule.ts`**

```ts
import { z } from 'zod';
import type { ToolMeta } from '../types';

export const tasksPauseScheduleMeta: ToolMeta = {
  name: 'tasks_pause_schedule',
  category: 'Tasks',
  description:
    'Pause a recurring task. The schedule remains attached but the task will not fire until ' +
    'tasks_resume_schedule is called. Does not affect in-progress runs.',
};

export const tasksPauseScheduleInputSchema = z.object({
  taskId: z.string().min(1),
});

export async function tasksPauseScheduleTool(
  args: z.infer<typeof tasksPauseScheduleInputSchema>,
  ctx: { taskScheduleService: TaskScheduleService },
): Promise<ServiceResult<TaskScheduleDto>> {
  return ctx.taskScheduleService.pauseSchedule(args.taskId);
}
```

### 5. Add `tasks_resume_schedule`

**New file: `apps/server/src/tools/tasks/resume-schedule.ts`**

```ts
export const tasksResumeScheduleMeta: ToolMeta = {
  name: 'tasks_resume_schedule',
  category: 'Tasks',
  description:
    'Resume a paused recurring task. The schedule becomes active and the task will fire on its next ' +
    'computed nextRunAt. Cannot resume an expired schedule (one that reached maxExecutions).',
};

export const tasksResumeScheduleInputSchema = z.object({
  taskId: z.string().min(1),
});

export async function tasksResumeScheduleTool(
  args: z.infer<typeof tasksResumeScheduleInputSchema>,
  ctx: { taskScheduleService: TaskScheduleService },
): Promise<ServiceResult<TaskScheduleDto>> {
  return ctx.taskScheduleService.resumeSchedule(args.taskId);
}
```

### 6. Add `tasks_trigger_now`

**New file: `apps/server/src/tools/tasks/trigger-now.ts`**

```ts
export const tasksTriggerNowMeta: ToolMeta = {
  name: 'tasks_trigger_now',
  category: 'Tasks',
  description:
    'Run a recurring task immediately, regardless of its nextRunAt. Creates an execution history ' +
    'row but does not change the nextRunAt or executionCount. Useful when the user wants to test ' +
    'a recurring task without waiting for the next scheduled time.',
};

export const tasksTriggerNowInputSchema = z.object({
  taskId: z.string().min(1),
});

export async function tasksTriggerNowTool(
  args: z.infer<typeof tasksTriggerNowInputSchema>,
  ctx: { taskScheduleService: TaskScheduleService },
): Promise<ServiceResult<{ historyId: string }>> {
  return ctx.taskScheduleService.triggerNow(args.taskId);
}
```

### 7. Add `tasks_list_executions`

**New file: `apps/server/src/tools/tasks/list-executions.ts`**

```ts
export const tasksListExecutionsMeta: ToolMeta = {
  name: 'tasks_list_executions',
  category: 'Tasks',
  description:
    'List past executions of a recurring task. Each execution has a status (planned/planning/' +
    'executing/verifying/completed/failed), timestamps, duration, and a link to the underlying session. ' +
    'Use this to investigate failed runs or check that a task is firing on schedule.',
};

export const tasksListExecutionsInputSchema = z.object({
  taskId: z.string().min(1),
  status: z
    .enum([
      'planned',
      'planning',
      'executing',
      'verifying',
      'completed',
      'failed',
    ])
    .optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export async function tasksListExecutionsTool(
  args: z.infer<typeof tasksListExecutionsInputSchema>,
  ctx: { taskScheduleService: TaskScheduleService },
): Promise<
  ServiceResult<{
    items: TaskExecutionHistoryDto[];
    total: number;
    limit: number;
    offset: number;
  }>
> {
  return ctx.taskScheduleService.listExecutions(args.taskId, {
    ...(args.status ? { status: args.status } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.offset !== undefined ? { offset: args.offset } : {}),
  });
}
```

### 8. Register all new tools in the catalog

**Update: `apps/server/src/tools/catalog.ts`**

Append the new metas to `ALL_TOOL_METAS`:

```ts
import { tasksPauseScheduleMeta } from './tasks/pause-schedule.js';
import { tasksResumeScheduleMeta } from './tasks/resume-schedule.js';
import { tasksTriggerNowMeta } from './tasks/trigger-now.js';
import { tasksListExecutionsMeta } from './tasks/list-executions.js';

export const ALL_TOOL_METAS: ToolMeta[] = [
  // ... existing ...
  tasksListMeta,
  tasksCreateMeta,
  tasksUpdateMeta,
  tasksDeleteMeta,
  tasksDeliverableUpdateMeta,
  // New (appended in the same Tasks category block):
  tasksPauseScheduleMeta,
  tasksResumeScheduleMeta,
  tasksTriggerNowMeta,
  tasksListExecutionsMeta,
];
```

### 9. Update `tools/tasks/index.ts` to re-export the new tools

**Update: `apps/server/src/tools/tasks/index.ts`**

```ts
export * from './create.js';
export * from './list.js';
export * from './update.js';
export * from './delete.js';
// New
export * from './pause-schedule.js';
export * from './resume-schedule.js';
export * from './trigger-now.js';
export * from './list-executions.js';
```

### 10. Register the tool implementations in `tools/registry.ts`

**Update: `apps/server/src/tools/registry.ts`**

Inside the `createBuiltinToolRegistry` (or wherever tasks tools are wired), add the new tools:

```ts
const tasksTools = {
  tasks_list: tasksListTool,
  tasks_create: tasksCreateTool,
  tasks_update: tasksUpdateTool,
  tasks_delete: tasksDeleteTool,
  tasks_pause_schedule: tasksPauseScheduleTool,
  tasks_resume_schedule: tasksResumeScheduleTool,
  tasks_trigger_now: tasksTriggerNowTool,
  tasks_list_executions: tasksListExecutionsTool,
};
```

Ensure the registry iterates these and registers them with their `ToolMeta`.

### 11. Tests

**New file: `apps/server/src/tools/tasks/tools.test.ts`** (extend the existing one)

Cover each new tool:

- `tasks_pause_schedule` calls the service and returns the DTO
- `tasks_resume_schedule` calls the service and returns the DTO
- `tasks_trigger_now` calls the executor and returns the history ID
- `tasks_list_executions` paginates correctly
- `tasks_create` with a schedule forwards it to the service
- `tasks_create` without a schedule is backward compatible
- `tasks_update` with `schedule: null` removes the schedule
- `tasks_update` with `schedule: {...}` updates the schedule
- All tools return `ServiceResult` shape

Use mock services — the tools are thin pass-throughs.

### 12. Update the agent's system prompt

The system prompt that lists available tools is built from `ALL_TOOL_METAS`. No code change is needed, but verify that the new tools appear in the system prompt by:

1. Starting the server
2. Opening a chat session
3. Asking "what tools do you have?"
4. Verifying the new tools are listed

---

## Rollout

Phase 5 makes the feature accessible to agents. The user can now ask in chat: "Make this task run every 5 minutes."

Rollout steps:

1. Ship the tool changes
2. Manual chat test: create a task in chat, then say "run it every 5 minutes" and verify the agent uses `tasks_update` with a schedule
3. Verify all 6 new tools are listed in the agent's tool manifest
4. Run the tool test suite
5. If clean, proceed to Phase 6

## Risk assessment

| Risk                                           | Mitigation                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Agent accidentally removes a schedule          | `tasks_update` requires the agent to pass `schedule: null` explicitly — not destructive by default |
| Tool description is misleading                 | Descriptions are reviewed for clarity; examples in description help                                |
| Tool call overflows token budget               | Zod schemas reject oversized inputs at parse time                                                  |
| New tool appears in system prompt unexpectedly | The agent's tool list grows by 4; tested in CI for prompt length                                   |
