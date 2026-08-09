# Phase 4: REST API

## Overview

Phase 4 exposes the schedule functionality through the existing `/api/tasks` REST surface. The routes are thin adapters over `TaskScheduleService`. Authentication, validation, and response shaping happen here; all business logic lives in the service.

By the end of Phase 4, any HTTP client (the web UI, an external automation, a curl one-liner) can manage recurring tasks.

## Objectives

- Extend `POST /api/tasks` to accept an optional `schedule` field
- Extend `GET /api/tasks` and `GET /api/tasks/:id` to include the `schedule` field
- Add `PATCH /api/tasks/:id/schedule` for schedule updates
- Add `POST /api/tasks/:id/schedule/pause` and `/resume`
- Add `DELETE /api/tasks/:id/schedule` (remove the schedule)
- Add `GET /api/tasks/:id/executions` for history
- Extend `POST /api/tasks/:id/trigger` to create a history row for recurring tasks
- Define Zod schemas for all new request/response shapes
- Apply the standard `requireAuth` preHandler
- Document each new endpoint with OpenAPI-style comments matching the Pulses API conventions

## Success criteria

- All new endpoints require authentication
- The `schedule` field in `POST /api/tasks` is optional (backward compatible)
- The `schedule` field in task responses is only present when a schedule exists
- `PATCH /api/tasks/:id/schedule` accepts all three operations: add, update, remove
- `GET /api/tasks/:id/executions` paginates and filters correctly
- Validation errors return `400` with a structured Zod error body
- All endpoints return the documented status codes
- The `PulsesPage` API conventions are followed (response envelope: `{ data, error }` or resource-shaped)

---

## Implementation tasks

### 1. Define Zod schemas for schedule inputs

**New file: `apps/server/src/routes/tasks/schemas.ts`**

```ts
import { z } from 'zod';

export const schedulePresetSchema = z.enum([
  '15m',
  '30m',
  '1h',
  '6h',
  '12h',
  '1d',
  '1w',
]);

export const scheduleInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('every'),
    every: schedulePresetSchema,
  }),
  z.object({
    kind: z.literal('daily'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal('cron'),
    cron: z.string().min(1).max(100),
    tz: z.string().optional(),
  }),
  z.object({
    kind: z.literal('at'),
    at: z.string().datetime(),
  }),
]);

// Internal mapping to the existing ScheduleInput type from shared-types
export function toSharedScheduleInput(
  input: z.infer<typeof scheduleInputSchema>,
): import('@openaidy/shared-types').ScheduleInput {
  switch (input.kind) {
    case 'every':
      return { every: input.every };
    case 'daily':
      return { daily: { hour: input.hour, minute: input.minute } };
    case 'cron':
      return { cron: input.cron, ...(input.tz ? { tz: input.tz } : {}) };
    case 'at':
      return { at: input.at };
  }
}

export const createTaskScheduleSchema = z.object({
  schedule: scheduleInputSchema,
  /**
   * Whether to re-invoke the planning agent before each run.
   * - 'never' (default): reuse existing subtasks; cheap
   * - 'on-description-change': re-plan only when the description has been edited
   * - 'always': re-plan every run (expensive, opt-in)
   */
  replanPolicy: z.enum(['never', 'on-description-change', 'always']).optional(),
  /**
   * Maximum number of times the schedule will fire. Must be a positive integer.
   * Defaults to 9999 when omitted. No "infinite" option.
   */
  maxExecutions: z.number().int().positive().optional(),
});

export const updateTaskScheduleSchema = z.object({
  schedule: scheduleInputSchema.optional(),
  replanPolicy: z.enum(['never', 'on-description-change', 'always']).optional(),
  status: z.enum(['active', 'paused']).optional(),
  /**
   * New cap on the number of executions. Must be a positive integer.
   */
  maxExecutions: z.number().int().positive().optional(),
});

export const listExecutionsQuerySchema = z.object({
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
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});
```

### 2. Extend `POST /api/tasks` to accept `schedule`

**Update: `apps/server/src/routes/tasks.ts`**

In the existing `POST /` handler, add `schedule` to the Zod-validated body and pass it to the service:

```ts
const createTaskBodySchema = z.object({
  // ... existing fields ...
  schedule: createTaskScheduleSchema.optional(),
});

fastify.post<{ Body: z.infer<typeof createTaskBodySchema> }>(
  '/',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const parsed = createTaskBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const input = parsed.data;
    const createInput: CreateTaskInput = {
      title: input.title,
      description: input.description,
      // ... other fields ...
    };
    if (input.schedule) {
      createInput.schedule = {
        schedule: toSharedScheduleInput(input.schedule),
        ...(input.maxExecutions !== undefined
          ? { maxExecutions: input.maxExecutions }
          : {}),
        ...(input.replanPolicy !== undefined
          ? { replanPolicy: input.replanPolicy }
          : {}),
      };
    }
    const result = await taskService.createTask(createInput);
    if (!result.ok) return reply.code(400).send(result);
    return reply.code(201).send(result.data);
  },
);
```

### 3. Add `GET /api/tasks/:id/schedule`

**Update: `apps/server/src/routes/tasks.ts`**

```ts
fastify.get<{ Params: { id: string } }>(
  '/:id/schedule',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const result = await taskSchedulesService.getScheduleForTask(
      request.params.id,
    );
    if (!result.ok) return reply.code(404).send(result);
    return reply.send(result.data);
  },
);
```

### 4. Add `PATCH /api/tasks/:id/schedule`

```ts
fastify.patch<{
  Params: { id: string };
  Body: z.infer<typeof updateTaskScheduleSchema>;
}>('/:id/schedule', { preHandler: [requireAuth] }, async (request, reply) => {
  const parsed = updateTaskScheduleSchema.safeParse(request.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });
  const input = parsed.data;
  const updateInput: UpdateTaskScheduleInput = {};
  if (input.schedule) {
    updateInput.schedule = toSharedScheduleInput(input.schedule);
  }
  if (input.status) updateInput.status = input.status;
  if (input.maxExecutions !== undefined) {
    updateInput.maxExecutions = input.maxExecutions;
  }
  const result = await taskSchedulesService.updateSchedule(
    request.params.id,
    updateInput,
  );
  if (!result.ok) return reply.code(400).send(result);
  return reply.send(result.data);
});
```

### 5. Add `POST /api/tasks/:id/schedule/pause` and `/resume`

```ts
fastify.post<{ Params: { id: string } }>(
  '/:id/schedule/pause',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const result = await taskSchedulesService.pauseSchedule(request.params.id);
    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result.data);
  },
);

fastify.post<{ Params: { id: string } }>(
  '/:id/schedule/resume',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const result = await taskSchedulesService.resumeSchedule(request.params.id);
    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result.data);
  },
);
```

### 6. Add `DELETE /api/tasks/:id/schedule`

```ts
fastify.delete<{ Params: { id: string } }>(
  '/:id/schedule',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const result = await taskSchedulesService.removeSchedule(request.params.id);
    if (!result.ok) return reply.code(404).send(result);
    return reply.code(204).send();
  },
);
```

### 7. Add `GET /api/tasks/:id/executions`

```ts
fastify.get<{
  Params: { id: string };
  Querystring: z.infer<typeof listExecutionsQuerySchema>;
}>('/:id/executions', { preHandler: [requireAuth] }, async (request, reply) => {
  const parsed = listExecutionsQuerySchema.safeParse(request.query);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });
  const result = await taskSchedulesService.listExecutions(
    request.params.id,
    parsed.data,
  );
  if (!result.ok) return reply.code(400).send(result);
  return reply.send(result.data);
});
```

### 8. Extend `POST /api/tasks/:id/trigger` to create a history row

The existing trigger route calls `taskService.executeTask(taskId)`. For recurring tasks, this should also write to the history table.

**Update: `apps/server/src/routes/tasks.ts`**

The current implementation calls `executeTask` directly. For tasks with a schedule, the better path is:

```ts
fastify.post<{ Params: { id: string } }>(
  '/:id/trigger',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const task = await taskService.getTask(request.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    // If the task has a schedule, use the executor's triggerNow (creates history row)
    // Otherwise, use the existing executeTask path.
    const schedule = await taskSchedulesService.getScheduleForTask(
      request.params.id,
    );
    if (schedule.ok) {
      const result = await taskSchedulesService.triggerNow(request.params.id);
      if (!result.ok) return reply.code(400).send(result);
      return reply.send({ sessionId: null, historyId: result.data.historyId });
    }

    // Fallback: non-recurring task, use the original executeTask
    const result = await taskService.executeTask(request.params.id);
    if (!result.ok) return reply.code(400).send(result);
    return reply.send({ sessionId: result.data.sessionId, historyId: null });
  },
);
```

### 9. Update the existing `GET /api/tasks` to include `schedule`

The current `GET /api/tasks` returns the raw `tasks` rows. Update it (or the `listTasksForKanban` endpoint) to include the `schedule` field on each task. This is done at the service layer in Phase 3, so the route change is minimal:

```ts
fastify.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
  const board = await taskService.listTasksForKanban();
  return reply.send(board);
});
```

The shape now includes `schedule` on each task object when a schedule is attached.

### 10. Update `GET /api/tasks/:id`

```ts
fastify.get<{ Params: { id: string } }>(
  '/:id',
  { preHandler: [requireAuth] },
  async (request, reply) => {
    const task = await taskService.getTaskWithDetails(request.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return reply.send(task);
  },
);
```

The `TaskWithDetails` DTO already includes the `schedule` field from Phase 3.

### 11. Wire the route dependencies

**Update: `apps/server/src/routes/tasks.ts`**

The plugin options must now include `taskSchedulesService`:

```ts
export type TaskRoutesOptions = {
  // ... existing fields ...
  taskSchedulesService: TaskScheduleService | undefined;
};
```

**Update: `apps/server/src/app.ts`**

Pass the new service:

```ts
await app.register(taskRoutes, {
  taskService,
  planningService,
  deliverablesRepo: dbAdapter.repositories.deliverables,
  taskSchedulesService: services.taskSchedules,
  authMiddleware,
});
```

### 12. API documentation comment block

Add a documentation header at the top of the routes file (or in a sibling `docs.ts`) following the conventions of `routes/pulses.ts`. This becomes the source of truth for the OpenAidy docs site.

### 13. Tests

**Update: `apps/server/src/routes/tasks.test.ts`**

Add tests for each new endpoint:

- `POST /api/tasks` with `schedule` creates a task with a schedule
- `POST /api/tasks` with `schedule` but no `maxExecutions` defaults to 9999
- `POST /api/tasks` with `schedule.maxExecutions: 0` returns `400`
- `POST /api/tasks` without `schedule` is unchanged (backward compatibility)
- `GET /api/tasks/:id` returns the schedule when present
- `GET /api/tasks/:id/schedule` returns the schedule or `404`
- `PATCH /api/tasks/:id/schedule` updates the cron and recomputes nextRunAt
- `PATCH /api/tasks/:id/schedule` can pause via `status: 'paused'`
- `DELETE /api/tasks/:id/schedule` removes the schedule
- `POST /api/tasks/:id/schedule/pause` toggles status
- `POST /api/tasks/:id/schedule/resume` toggles status
- `GET /api/tasks/:id/executions` paginates and filters by status
- `POST /api/tasks/:id/trigger` on a recurring task creates a history row
- All endpoints reject unauthenticated requests with `401`
- Invalid cron expressions return `400`

---

## Rollout

Phase 4 is the first user-visible change. The feature is opt-in (no `schedule` field → no change).

Rollout steps:

1. Ship the route changes
2. Manual smoke test with curl/Postman for each endpoint
3. Verify backward compatibility: existing tasks (no schedule) still respond correctly
4. Verify the web UI continues working (no UI changes yet, but `GET /api/tasks` shape changed slightly)
5. If clean, proceed to Phase 5

## Risk assessment

| Risk                                                | Mitigation                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/tasks` body schema change breaks clients | `schedule` is optional; existing payloads pass through unchanged          |
| Zod validation errors leak stack traces             | Use `error.flatten()` and return only field-level messages                |
| `GET /api/tasks` shape change breaks web UI         | Web UI is updated in Phase 6 to handle the optional `schedule` field      |
| Auth not enforced on new routes                     | All routes use `{ preHandler: [requireAuth] }` — same as existing routes  |
| Rate limiting missing                               | Inherits the existing per-route limits (none today); defer to a v2 effort |
