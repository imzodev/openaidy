import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { TaskService } from '../tasks/service';

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  planningEnabled: z.boolean().optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string(),
        role: z.enum(['primary', 'secondary', 'reviewer']).optional(),
      })
    )
    .optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  planningEnabled: z.boolean().optional(),
});

const updateTaskStatusSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']),
});

const assignAgentsSchema = z.object({
  agents: z.array(
    z.object({
      agentId: z.string(),
      role: z.enum(['primary', 'secondary', 'reviewer']).optional(),
    })
  ),
});

/**
 * Task routes options
 */
export type TaskRoutesOptions = {
  taskService: TaskService;
};

export const taskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (
  app,
  options
) => {
  const { taskService } = options;

  /**
   * GET /tasks
   * List all tasks, optionally filtered by status
   */
  app.get('/tasks', async (request) => {
    const query = request.query as { status?: string };
    const status = query.status as
      | 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
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
          message: error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const createInput: {
      title: string;
      description: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      planningEnabled?: boolean;
      agents?: Array<{ agentId: string; role?: 'primary' | 'secondary' | 'reviewer' }>;
    } = {
      title: parsed.title,
      description: parsed.description,
    };
    if (parsed.priority !== undefined) {
      createInput.priority = parsed.priority;
    }
    if (parsed.planningEnabled !== undefined) {
      createInput.planningEnabled = parsed.planningEnabled;
    }
    if (parsed.agents !== undefined) {
      createInput.agents = parsed.agents.map((a) => ({
        agentId: a.agentId,
        ...(a.role !== undefined && { role: a.role }),
      }));
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
      return { ok: false, error: { code: 'task.not_found', message: `Task "${id}" not found` } };
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
          message: error instanceof Error ? error.message : 'Invalid request body',
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
          message: error instanceof Error ? error.message : 'Invalid request body',
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
          message: error instanceof Error ? error.message : 'Invalid request body',
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
    const { taskId, agentId } = request.params as { taskId: string; agentId: string };

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
  app.get('/tasks/:taskId/progress', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    const progress = await taskService.getTaskProgress(taskId);
    return { ok: true, data: progress };
  });

  /**
   * POST /tasks/:id/execute
   * Execute a task by creating a session
   */
  app.post('/tasks/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await taskService.executeTask(id);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'task.not_found') {
        reply.code(404);
      } else if (result.error.code === 'session.not_configured') {
        reply.code(503);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
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
      if (result.error.code === 'subtask.not_found') {
        reply.code(404);
      } else if (result.error.code === 'session.not_configured') {
        reply.code(503);
      } else {
        reply.code(500);
      }
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
   * POST /tasks/:id/plan
   * Plan a task (decompose into subtasks using AI)
   * Note: This is a placeholder that returns existing subtasks.
   * Full implementation requires PlanningService integration.
   */
  app.post('/tasks/:id/plan', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check if task exists
    const task = await taskService.getTaskWithDetails(id);
    if (!task) {
      reply.code(404);
      return { ok: false, error: { code: 'task.not_found', message: `Task "${id}" not found` } };
    }

    // Get existing subtasks
    const subtasks = await taskService.getSubtasks(id);

    // Return the subtasks (placeholder for actual planning)
    return { ok: true, data: { subtasks } };
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
      if (result.error.code === 'task.not_found') {
        reply.code(404);
      } else {
        reply.code(500);
      }
      return { ok: false, error: result.error };
    }
  });

  /**
   * GET /tasks/:taskId/subtasks/next
   * Get next executable subtasks
   */
  app.get('/tasks/:taskId/subtasks/next', async (request, reply) => {
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
};
