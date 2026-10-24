import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { TaskService } from '../tasks/service';
import type { UpdateSubtaskInput } from '../types';
import { parseGraphSpec } from '../tasks/graph-spec';
import type { PlanningService } from '../planning/service';
import type { DeliverablesRepository, WorkflowRun } from '@openaidy/db';
import type {
  PendingApprovalDto,
  WorkflowRunDto,
} from '@openaidy/shared-types';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import { deriveTitleFromDescription } from '../tasks/derive-title';

// Validation schemas

// Nested `schedule` schema for createTask. Matches the public
// CreateTaskScheduleInput shape, with `replanPolicy` and
// `maxExecutions` as optional fields. Server-side defaults:
// `replanPolicy='never'`, `maxExecutions=9999`.
// API input for a task's schedule. Mirrors the canonical
// `ScheduleInput` discriminated union from
// `packages/shared-types/src/pulses.ts`:
//   - one-level `cron: string` (plus optional `tz`),
//   - `every: preset`, `daily: { hour, minute }`, `at: ISO datetime`.
//
// The `ScheduleEditor` in the web client produces this shape
// directly, and the same shape is also produced by the
// `pulses_create` / `pulses_update` / `task_schedules_create` /
// `task_schedules_update` tools (we unified them on this canonical
// shape in Phase 5).
const taskScheduleInputSchema = z.object({
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
    z.object({
      cron: z.string().min(1),
      tz: z.string().optional(),
    }),
    z.object({
      at: z.string().datetime(),
    }),
  ]),
  replanPolicy: z.enum(['never', 'on-description-change', 'always']).optional(),
  /**
   * Positive integer. Defaults to 9999 when omitted. There is no
   * "infinite" option.
   */
  maxExecutions: z.number().int().positive().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  planningEnabled: z.boolean().optional(),
  /**
   * Skip the automatic AI planner even when planningEnabled is true —
   * used by the workflow graph editor's "New Workflow" creation, where
   * the user hand-authors the subtask graph themselves.
   */
  skipAutoPlan: z.boolean().optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string(),
        role: z.enum(['primary', 'secondary', 'reviewer']).optional(),
      }),
    )
    .optional(),
  /**
   * Optional schedule attached to the task on creation. When
   * present, the TaskService calls TaskScheduleService.createSchedule
   * internally after the task row is inserted. The same `schedule`
   * shape is accepted on the dedicated POST /api/tasks/:taskId/schedule
   * endpoint for adding a schedule to an existing task.
   */
  schedule: taskScheduleInputSchema.optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  planningEnabled: z.boolean().optional(),
  // Schedule fields are NOT updated through PATCH /tasks/:id. Use
  // the dedicated endpoints under /api/tasks/:taskId/schedule to
  // create/update/pause/resume/remove/trigger/list history of the
  // schedule. This keeps the surface area of PATCH /tasks/:id
  // small and avoids ambiguous bodies ("does `schedule: {...}` mean
  // create or update?").
});

const updateTaskStatusSchema = z.object({
  status: z.enum([
    'backlog',
    'todo',
    'in_progress',
    'review',
    'done',
    'cancelled',
  ]),
});

const assignAgentsSchema = z.object({
  agents: z.array(
    z.object({
      agentId: z.string(),
      role: z.enum(['primary', 'secondary', 'reviewer']).optional(),
    }),
  ),
});

const conditionSchema = z.object({
  operator: z.enum(['equals', 'contains', 'matches_regex']),
  value: z.string().min(1),
});

const loopSchema = z.object({
  maxIterations: z.number().int().positive(),
  conditionOperator: z.enum(['equals', 'contains', 'matches_regex']),
  conditionValue: z.string().min(1),
});

const createSubtaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  orderIndex: z.number().int().optional(),
  assignedAgentId: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  subtaskKind: z.enum(['agent', 'approval_gate']).optional(),
  loop: loopSchema.nullable().optional(),
});

const createSubtaskEdgeSchema = z.object({
  subtaskId: z.string().min(1),
  dependsOnSubtaskId: z.string().min(1),
  edgeKind: z.enum(['dependency', 'conditional']).optional(),
  condition: conditionSchema.nullable().optional(),
});

const updateSubtaskEdgeSchema = z.object({
  edgeKind: z.enum(['dependency', 'conditional']).optional(),
  condition: conditionSchema.nullable().optional(),
});

const resolveApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
});

const applyWorkflowTemplateSchema = z.object({
  templateId: z.string().min(1),
  inputs: z.record(z.string()).optional(),
  /** Replace the current steps instead of adding to them. */
  clearExisting: z.boolean().optional(),
});

const updateSubtaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  orderIndex: z.number().int().optional(),
  subtaskKind: z.enum(['agent', 'approval_gate']).optional(),
  loop: loopSchema.nullable().optional(),
});

const layoutSchema = z.object({
  positions: z.record(
    z.object({ x: z.number().finite(), y: z.number().finite() }),
  ),
});

/**
 * Task routes options
 */
export type TaskRoutesOptions = {
  taskService: TaskService;
  planningService?: PlanningService;
  deliverablesRepo?: DeliverablesRepository;
  authMiddleware: AuthMiddleware;
};

/** HTTP status for task, workflow-graph and workflow-run error codes. */
function errorStatus(code: string): number {
  switch (code) {
    case 'task.not_found':
    case 'subtask.not_found':
    case 'edge.not_found':
    case 'template.not_found':
      return 404;
    case 'session.not_configured':
      return 503;
    case 'workflow.already_running':
    case 'workflow.not_running':
    case 'workflow.locked':
    case 'subtask.already_executed':
    case 'subtask.dependency_not_met':
    case 'subtask.not_retryable':
      return 409;
    case 'workflow.invalid_graph':
    case 'agent.not_found':
    case 'edge.self_edge':
    case 'edge.condition_required':
    case 'edge.would_create_cycle':
    case 'template.missing_input':
      return 400;
    default:
      return 500;
  }
}

function invalidRequest(message: string) {
  return {
    ok: false as const,
    error: { code: 'validation.invalid_request', message },
  };
}

function toWorkflowRunDto(run: WorkflowRun): WorkflowRunDto {
  let summary: WorkflowRunDto['summary'] = null;
  if (run.summary) {
    try {
      summary = JSON.parse(run.summary) as WorkflowRunDto['summary'];
    } catch {
      summary = null;
    }
  }
  return {
    id: run.id,
    taskId: run.taskId,
    trigger: run.trigger,
    status: run.status,
    sessionId: run.sessionId,
    error: run.error,
    summary,
    input: run.input ?? null,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
  };
}

export const taskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (
  app,
  options,
) => {
  const { taskService, authMiddleware, deliverablesRepo } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  /**
   * GET /tasks
   * List all tasks, optionally filtered by status
   */
  app.get('/tasks', async (request) => {
    const query = request.query as { status?: string };
    const status = query.status as
      | 'backlog'
      | 'todo'
      | 'in_progress'
      | 'review'
      | 'done'
      | 'cancelled'
      | undefined;

    const items = await taskService.listTasks(status);
    return { items };
  });

  /**
   * GET /tasks/kanban
   * List tasks grouped by status for Kanban board
   */
  app.get('/tasks/kanban', async () => {
    const board = await taskService.listTasksForKanban();
    return board;
  });

  /**
   * POST /tasks
   * Create a new task
   */
  app.post('/tasks', async (request, reply) => {
    let parsed;
    try {
      parsed = createTaskSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const derivedTitle =
      parsed.title ?? deriveTitleFromDescription(parsed.description);

    const createInput: {
      title: string;
      description: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      planningEnabled?: boolean;
      skipAutoPlan?: boolean;
      agents?: Array<{
        agentId: string;
        role?: 'primary' | 'secondary' | 'reviewer';
      }>;
      schedule?: import('@openaidy/shared-types').CreateTaskScheduleInput;
    } = {
      title: derivedTitle,
      description: parsed.description,
    };
    if (parsed.priority !== undefined) {
      createInput.priority = parsed.priority;
    }
    if (parsed.planningEnabled !== undefined) {
      createInput.planningEnabled = parsed.planningEnabled;
    }
    if (parsed.skipAutoPlan !== undefined) {
      createInput.skipAutoPlan = parsed.skipAutoPlan;
    }
    if (parsed.agents !== undefined) {
      createInput.agents = parsed.agents.map((a) => ({
        agentId: a.agentId,
        ...(a.role !== undefined && { role: a.role }),
      }));
    }
    if (parsed.schedule !== undefined) {
      // The schema accepts the canonical ScheduleInput shape (one
      // level deep: `cron: string`, `every: preset`, `daily: ...`,
      // `at: ISO`). Pass it through to the service as-is.
      //
      // The Zod-inferred type allows `tz: string | undefined` while
      // ScheduleInput is `tz?: string` (omittable, not explicitly
      // undefined) under exactOptionalPropertyTypes. We cast through
      // `unknown` to coerce — safe because the Zod schema and
      // ScheduleInput both accept the same shape (the same union
      // variants, just different optional semantics).
      const createScheduleInput: import('@openaidy/shared-types').CreateTaskScheduleInput =
        {
          schedule: parsed.schedule
            .schedule as unknown as import('@openaidy/shared-types').ScheduleInput,
        };
      if (parsed.schedule.replanPolicy !== undefined) {
        createScheduleInput.replanPolicy = parsed.schedule.replanPolicy;
      }
      if (parsed.schedule.maxExecutions !== undefined) {
        createScheduleInput.maxExecutions = parsed.schedule.maxExecutions;
      }
      createInput.schedule = createScheduleInput;
    }

    const result = await taskService.createTask(createInput);

    if (result.ok) {
      reply.code(201);
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'agent.not_found') {
        reply.code(400);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /tasks/:id
   * Get a task by ID with full details
   */
  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await taskService.getTaskWithDetails(id);
    if (!task) {
      reply.code(404);
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }

    return { ok: true, data: task };
  });

  /**
   * PATCH /tasks/:id
   * Update a task
   */
  app.patch('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateTaskSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const updateInput: {
      title?: string;
      description?: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      planningEnabled?: boolean;
    } = {};
    if (parsed.title !== undefined) {
      updateInput.title = parsed.title;
    }
    if (parsed.description !== undefined) {
      updateInput.description = parsed.description;
    }
    if (parsed.priority !== undefined) {
      updateInput.priority = parsed.priority;
    }
    if (parsed.planningEnabled !== undefined) {
      updateInput.planningEnabled = parsed.planningEnabled;
    }

    const result = await taskService.updateTask(id, updateInput);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'task.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * DELETE /tasks/:id
   * Delete a task
   */
  app.delete('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.deleteTask(id);

    if (result.ok) {
      return { ok: true };
    } else {
      reply.code(404);
      return { ok: false, error: result.error };
    }
  });

  /**
   * PATCH /tasks/:id/status
   * Update a task's status
   */
  app.patch('/tasks/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateTaskStatusSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const result = await taskService.updateTaskStatus(id, parsed.status);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'task.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * POST /tasks/:taskId/agents
   * Assign agents to a task
   */
  app.post('/tasks/:taskId/agents', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    let parsed;
    try {
      parsed = assignAgentsSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const agentsInput = parsed.agents.map((a) => ({
      agentId: a.agentId,
      ...(a.role !== undefined && { role: a.role }),
    }));

    const result = await taskService.assignAgents(taskId, agentsInput);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'task.not_found') {
        reply.code(404);
      } else if (result.error.code === 'agent.not_found') {
        reply.code(400);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * DELETE /tasks/:taskId/agents/:agentId
   * Remove an agent from a task
   */
  app.delete('/tasks/:taskId/agents/:agentId', async (request, reply) => {
    const { taskId, agentId } = request.params as {
      taskId: string;
      agentId: string;
    };

    const result = await taskService.removeAgent(taskId, agentId);

    if (result.ok) {
      return { ok: true };
    } else {
      reply.code(500);
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /tasks/:taskId/progress
   * Get task progress info
   */
  app.get('/tasks/:taskId/progress', async (request, _reply) => {
    const { taskId } = request.params as { taskId: string };

    const progress = await taskService.getTaskProgress(taskId);
    return { ok: true, data: progress };
  });

  /**
   * POST /tasks/:id/execute
   * Start a new run of the task's workflow (every step is reset first).
   * Returns as soon as the run has started; steps continue in the
   * background.
   */
  app.post('/tasks/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = (request.body as { input?: unknown } | undefined)?.input;

    const result = await taskService.executeTask(
      id,
      typeof input === 'string' && input.trim() ? { input } : {},
    );

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      reply.code(errorStatus(result.error.code));
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /tasks/:id/runs
   * The task's workflow runs, newest first.
   */
  app.get('/tasks/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string };
    const task = await taskService.getTask(id);
    if (!task) {
      reply.code(404);
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const runs = await taskService.listRuns(id, limit);
    return { ok: true, data: runs.map(toWorkflowRunDto) };
  });

  /**
   * GET /approvals/pending
   * Approval gates waiting for a decision, across all workflows.
   */
  app.get('/approvals/pending', async () => {
    const rows = await taskService.listPendingApprovals();
    const data: PendingApprovalDto[] = rows.map((s) => ({
      subtaskId: s.id,
      title: s.title,
      description: s.description,
      taskId: s.taskId,
      taskTitle: s.taskTitle,
      since: new Date(s.awaitingApprovalSince ?? s.updatedAt).toISOString(),
    }));
    return { ok: true, data };
  });

  /**
   * POST /tasks/:id/runs/cancel
   * Stop the task's running workflow run.
   */
  app.post('/tasks/:id/runs/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await taskService.cancelRun(id);
    if (result.ok) {
      return { ok: true, data: toWorkflowRunDto(result.data) };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * POST /subtasks/:id/retry
   * Run a failed or skipped step again (with everything after it),
   * continuing the latest run.
   */
  app.post('/subtasks/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await taskService.retrySubtask(id);
    if (result.ok) {
      return { ok: true, data: result.data };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * GET /tasks/:id/session
   * Get the session linked to a task
   */
  app.get('/tasks/:id/session', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.getTaskSession(id);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'task.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * POST /subtasks/:id/execute
   * Execute a subtask by creating a session
   */
  app.post('/subtasks/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.executeSubtask(id);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      reply.code(errorStatus(result.error.code));
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /subtasks/:id/session
   * Get the session linked to a subtask
   */
  app.get('/subtasks/:id/session', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.getSubtaskSession(id);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'subtask.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /tasks/:id/subtasks
   * List all subtasks for a task
   */
  app.get('/tasks/:id/subtasks', async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await taskService.getTaskWithDetails(id);
    if (!task) {
      reply.code(404);
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }

    const subtasks = await taskService.getSubtasks(id);
    return { ok: true, data: { items: subtasks } };
  });

  /**
   * POST /tasks/:taskId/subtasks
   * Manually create a subtask (independent of AI planning). Used by the
   * workflow editor to add nodes to the subtask graph.
   */
  app.post('/tasks/:taskId/subtasks', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    let parsed;
    try {
      parsed = createSubtaskSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const result = await taskService.createSubtask({
      taskId,
      title: parsed.title ?? deriveTitleFromDescription(parsed.description),
      description: parsed.description,
      ...(parsed.orderIndex !== undefined && {
        orderIndex: parsed.orderIndex,
      }),
      ...(parsed.assignedAgentId !== undefined && {
        assignedAgentId: parsed.assignedAgentId,
      }),
      ...(parsed.dependsOn !== undefined && { dependsOn: parsed.dependsOn }),
      ...(parsed.subtaskKind !== undefined && {
        subtaskKind: parsed.subtaskKind,
      }),
      ...(parsed.loop !== undefined && { loop: parsed.loop }),
    });

    if (result.ok) {
      reply.code(201);
      return { ok: true, data: result.data };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * POST /tasks/:id/plan
   * Plan a task (decompose into subtasks using AI)
   */
  app.post('/tasks/:id/plan', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check if task exists
    const task = await taskService.getTaskWithDetails(id);
    if (!task) {
      reply.code(404);
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }

    // Use PlanningService if available, otherwise fall back to returning existing subtasks
    if (options.planningService) {
      const planningResult = await options.planningService.planTask(id);
      if (!planningResult.ok) {
        reply.code(400);
        return { ok: false, error: planningResult.error };
      }
      // Get all subtasks after planning (including newly created ones)
      const subtasks = await taskService.getSubtasks(id);
      return { ok: true, data: { subtasks } };
    }

    // Fallback: return existing subtasks without AI planning
    const subtasks = await taskService.getSubtasks(id);
    return { ok: true, data: { subtasks } };
  });

  /**
   * POST /tasks/:id/apply-template
   * Seed a task's subtask graph from a workflow template (as an
   * alternative to AI auto-planning or hand-authoring). Only creates
   * subtasks/edges — it does not touch planningStatus.
   */
  app.post('/tasks/:id/apply-template', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = applyWorkflowTemplateSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const result = await taskService.applyWorkflowTemplate(
      id,
      parsed.templateId,
      parsed.inputs ?? {},
      { clearExisting: parsed.clearExisting ?? false },
    );

    if (result.ok) {
      reply.code(201);
      return { ok: true, data: result.data };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * POST /tasks/:taskId/subtasks/execute
   * Execute all pending subtasks for a task
   */
  app.post('/tasks/:taskId/subtasks/execute', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    const result = await taskService.executeSubtasks(taskId);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      reply.code(errorStatus(result.error.code));
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /tasks/:taskId/subtasks/next
   * Get next executable subtasks
   */
  app.get('/tasks/:taskId/subtasks/next', async (request, _reply) => {
    const { taskId } = request.params as { taskId: string };

    const subtasks = await taskService.getNextExecutableSubtasks(taskId);
    return { ok: true, data: subtasks };
  });

  /**
   * POST /subtasks/:subtaskId/complete
   * Complete a subtask with result
   */
  app.post('/subtasks/:subtaskId/complete', async (request, reply) => {
    const { subtaskId } = request.params as { subtaskId: string };
    const body = request.body as { result: string } | undefined;

    if (!body?.result) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.missing_result',
          message: 'Result is required',
        },
      };
    }

    const result = await taskService.completeSubtask(subtaskId, body.result);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'subtask.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * POST /subtasks/:subtaskId/fail
   * Fail a subtask with error
   */
  app.post('/subtasks/:subtaskId/fail', async (request, reply) => {
    const { subtaskId } = request.params as { subtaskId: string };
    const body = request.body as { error: string } | undefined;

    if (!body?.error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.missing_error',
          message: 'Error message is required',
        },
      };
    }

    const result = await taskService.failSubtask(subtaskId, body.error);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'subtask.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * PATCH /subtasks/:id
   * Edit a subtask's title / description / order after planning. Any subset
   * of the three fields may be supplied; the corresponding DB row is
   * updated and the updated record is returned. Used by the web UI's
   * SubtaskList inline edit affordance.
   */
  app.patch('/subtasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSubtaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return invalidRequest(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    }
    const body = parsed.data;
    const input: UpdateSubtaskInput = {};
    if (body.title !== undefined) input.title = body.title;
    if (body.description !== undefined) input.description = body.description;
    if (body.orderIndex !== undefined) input.orderIndex = body.orderIndex;
    if (body.subtaskKind !== undefined) input.subtaskKind = body.subtaskKind;
    if (body.loop !== undefined) input.loop = body.loop;

    if (
      input.title === undefined &&
      input.description === undefined &&
      input.orderIndex === undefined &&
      input.subtaskKind === undefined &&
      input.loop === undefined
    ) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.empty_patch',
          message:
            'At least one of title, description, orderIndex, subtaskKind, or loop must be supplied',
        },
      };
    }
    if (input.description !== undefined && input.description.trim() === '') {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.empty_description',
          message: 'description must not be empty',
        },
      };
    }
    // Title is optional — clearing it (with a description in the same
    // request, which is how the workflow editor always saves the pair)
    // re-derives it instead of persisting a blank/whitespace title. A
    // title-only patch has no description to derive from, so it's
    // rejected rather than silently persisting a blank title.
    if (input.title !== undefined && input.title.trim() === '') {
      if (input.description === undefined) {
        reply.code(400);
        return {
          ok: false,
          error: {
            code: 'validation.empty_title',
            message:
              'title must not be empty unless description is supplied in the same request',
          },
        };
      }
      input.title = deriveTitleFromDescription(input.description);
    }

    const result = await taskService.updateSubtask(id, input);

    if (result.ok) {
      return { ok: true, data: result.data };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * DELETE /subtasks/:id
   * Delete a subtask. Used by the workflow editor to remove nodes.
   */
  app.delete('/subtasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.deleteSubtask(id);

    if (result.ok) {
      return { ok: true };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * POST /subtasks/:id/approval/resolve
   * Resolve a paused approval-gate subtask with a human decision.
   */
  app.post<{
    Params: { id: string };
    Body: { decision: 'approved' | 'rejected'; note?: string };
  }>('/subtasks/:id/approval/resolve', async (request, reply) => {
    const { id } = request.params;

    let parsed;
    try {
      parsed = resolveApprovalSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const result = await taskService.resolveApproval(
      id,
      parsed.decision,
      parsed.note,
    );

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'subtask.not_found') {
        reply.code(404);
      } else if (
        result.error.code === 'subtask.not_approval_gate' ||
        result.error.code === 'subtask.not_awaiting_approval'
      ) {
        reply.code(400);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  // ── Subtask dependency-graph edges ──────────────────────────────────────────

  /**
   * GET /tasks/:taskId/subtask-edges
   * List all dependency-graph edges for a task's subtasks.
   */
  app.get('/tasks/:taskId/subtask-edges', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    const result = await taskService.listSubtaskEdges(taskId);
    if (result.ok) {
      return { ok: true, data: { items: result.data } };
    } else {
      reply.code(result.error.code === 'task.not_found' ? 404 : 500);
      return { ok: false, error: result.error };
    }
  });

  /**
   * POST /tasks/:taskId/subtask-edges
   * Create a dependency-graph edge. Rejects self-edges, edges between
   * subtasks outside the task, missing conditions on conditional
   * edges, and edges that would create a cycle.
   */
  app.post('/tasks/:taskId/subtask-edges', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    let parsed;
    try {
      parsed = createSubtaskEdgeSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const result = await taskService.createSubtaskEdge(taskId, parsed);

    if (result.ok) {
      reply.code(201);
      return { ok: true, data: result.data };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * PATCH /subtask-edges/:id
   * Update an edge's kind/condition (e.g. converting a plain
   * dependency edge to a conditional one, or vice versa).
   */
  app.patch('/subtask-edges/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateSubtaskEdgeSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const result = await taskService.updateSubtaskEdge(id, parsed);

    if (result.ok) {
      return { ok: true, data: result.data };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * DELETE /subtask-edges/:id
   */
  app.delete('/subtask-edges/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.deleteSubtaskEdge(id);

    if (result.ok) {
      return { ok: true };
    }
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * POST /subtasks/:id/assign
   * (Re)assign an agent to a subtask. Used by the web UI's agent pickers.
   * Body: `{ agentId: string }`, or `{ agentId: null }` to unassign (the
   * session's default agent then runs the step).
   */
  app.post<{ Params: { id: string }; Body: { agentId?: string | null } }>(
    '/subtasks/:id/assign',
    async (request, reply) => {
      const { id } = request.params;
      const agentId = request.body?.agentId;
      if (agentId === null) {
        const result = await taskService.assignSubtaskAgent(id, null);
        if (result.ok) return { ok: true, data: result.data };
        reply.code(errorStatus(result.error.code));
        return { ok: false, error: result.error };
      }
      if (typeof agentId !== 'string' || agentId.trim() === '') {
        reply.code(400);
        return {
          ok: false,
          error: {
            code: 'validation.missing_agent_id',
            message: 'agentId is required',
          },
        };
      }

      const result = await taskService.assignSubtaskAgent(id, agentId);

      if (result.ok) {
        return { ok: true, data: result.data };
      }
      reply.code(errorStatus(result.error.code));
      return { ok: false, error: result.error };
    },
  );

  // ── Whole workflow graph ────────────────────────────────────────────────────

  /**
   * GET /tasks/:id/workflow-check
   * What would stop the workflow from running as built (errors) and what
   * looks unintended (warnings). Used by the editor's pre-run checklist.
   */
  app.get('/tasks/:id/workflow-check', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await taskService.checkWorkflow(id);
    if (result.ok) return { ok: true, data: result.data };
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * PUT /tasks/:id/graph
   * Replace the whole graph in one validated write. Body:
   * `{ nodes: [{key, title?, description, kind?, agent?, loop?}],
   *    edges: [{from, to, condition?}], dryRun? }` — see parseGraphSpec.
   * Nothing is written when the graph has errors (400, with
   * `error.details.issues`).
   */
  app.put('/tasks/:id/graph', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const spec = parseGraphSpec(body['nodes'], body['edges']);
    if (!spec.ok) {
      reply.code(400);
      return invalidRequest(spec.error);
    }
    const result = await taskService.setWorkflowGraph(id, spec.graph, {
      dryRun: body['dryRun'] === true,
    });
    if (result.ok) return { ok: true, data: result.data };
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  /**
   * PUT /tasks/:id/layout
   * Save where nodes sit on the canvas: `{ positions: {[subtaskId]: {x, y}} }`.
   * Allowed while a run is going — it doesn't change what the workflow does.
   */
  app.put('/tasks/:id/layout', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = layoutSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return invalidRequest('positions must map node ids to {x, y} numbers');
    }
    const result = await taskService.saveWorkflowLayout(
      id,
      parsed.data.positions,
    );
    if (result.ok) return { ok: true, data: result.data };
    reply.code(errorStatus(result.error.code));
    return { ok: false, error: result.error };
  });

  // ── Deliverables ────────────────────────────────────────────────────────────

  /**
   * GET /tasks/:id/deliverables
   * List all deliverables for a task
   */
  app.get('/tasks/:id/deliverables', async (request, reply) => {
    if (!deliverablesRepo) {
      reply.code(503);
      return {
        ok: false,
        error: {
          code: 'not_implemented',
          message: 'Deliverables not available',
        },
      };
    }

    const { id } = request.params as { id: string };

    const task = await taskService.getTask(id);
    if (!task) {
      reply.code(404);
      return {
        ok: false,
        error: { code: 'task.not_found', message: 'Task not found' },
      };
    }

    const deliverables = await deliverablesRepo.findByTask(id);
    return { ok: true, data: { items: deliverables } };
  });

  /**
   * PATCH /tasks/:taskId/deliverables/:deliverableId
   * Update a deliverable
   */
  app.patch(
    '/tasks/:taskId/deliverables/:deliverableId',
    async (request, reply) => {
      if (!deliverablesRepo) {
        reply.code(503);
        return {
          ok: false,
          error: {
            code: 'not_implemented',
            message: 'Deliverables not available',
          },
        };
      }

      const { taskId, deliverableId } = request.params as {
        taskId: string;
        deliverableId: string;
      };

      const task = await taskService.getTask(taskId);
      if (!task) {
        reply.code(404);
        return {
          ok: false,
          error: { code: 'task.not_found', message: 'Task not found' },
        };
      }

      const existing = await deliverablesRepo.findById(deliverableId);
      if (!existing) {
        reply.code(404);
        return {
          ok: false,
          error: {
            code: 'deliverable.not_found',
            message: 'Deliverable not found',
          },
        };
      }

      const body = request.body as Partial<{
        type: string;
        description: string;
        status: string;
        format: string;
        size: string;
        path: string;
        url: string;
        version: string;
      }>;

      const updateInput: Parameters<typeof deliverablesRepo.update>[1] = {};
      if (body.type)
        updateInput.type = body.type as NonNullable<
          Parameters<typeof deliverablesRepo.update>[1]['type']
        >;
      if (body.description) updateInput.description = body.description;
      if (body.status)
        updateInput.status = body.status as NonNullable<
          Parameters<typeof deliverablesRepo.update>[1]['status']
        >;
      if (body.format) updateInput.format = body.format;
      if (body.size) updateInput.size = body.size;
      if (body.path) updateInput.path = body.path;
      if (body.url) updateInput.url = body.url;
      if (body.version) updateInput.version = body.version;

      const updated = await deliverablesRepo.update(deliverableId, updateInput);
      return { ok: true, data: updated };
    },
  );
};
