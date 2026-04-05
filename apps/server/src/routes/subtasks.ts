import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { TaskService } from '../tasks/service';

// Validation schemas
const createSubtaskSchema = z.object({
  parentSubtaskId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  orderIndex: z.number().int().min(0).optional(),
  assignedAgentId: z.string().optional(),
});

const updateSubtaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  orderIndex: z.number().int().min(0).optional(),
});

const updateSubtaskStatusSchema = z.object({
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'failed']),
});

const assignSubtaskSchema = z.object({
  agentId: z.string(),
});

const setSubtaskResultSchema = z.object({
  result: z.string(),
});

/**
 * Subtask routes options
 */
export type SubtaskRoutesOptions = {
  taskService: TaskService;
};

export const subtaskRoutes: FastifyPluginAsync<SubtaskRoutesOptions> = async (
  app,
  options
) => {
  const { taskService } = options;

  /**
   * GET /tasks/:taskId/subtasks
   * List all subtasks for a task
   */
  app.get('/tasks/:taskId/subtasks', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    // Verify task exists
    const task = await taskService.getTask(taskId);
    if (!task) {
      reply.code(404);
      return { ok: false, error: { code: 'task.not_found', message: `Task "${taskId}" not found` } };
    }

    const items = await taskService.getSubtasks(taskId);
    return { ok: true, items };
  });

  /**
   * POST /tasks/:taskId/subtasks
   * Create a subtask
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
          message: error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    const createInput: {
      taskId: string;
      parentSubtaskId?: string;
      title: string;
      description: string;
      orderIndex?: number;
      assignedAgentId?: string;
    } = {
      taskId,
      title: parsed.title,
      description: parsed.description,
    };
    if (parsed.parentSubtaskId !== undefined) {
      createInput.parentSubtaskId = parsed.parentSubtaskId;
    }
    if (parsed.orderIndex !== undefined) {
      createInput.orderIndex = parsed.orderIndex;
    }
    if (parsed.assignedAgentId !== undefined) {
      createInput.assignedAgentId = parsed.assignedAgentId;
    }

    const result = await taskService.createSubtask(createInput);

    if (result.ok) {
      reply.code(201);
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
   * PATCH /subtasks/:id
   * Update a subtask
   */
  app.patch('/subtasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateSubtaskSchema.parse(request.body);
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

    // Note: We need to add an updateSubtask method to the service
    // For now, return not implemented
    reply.code(501);
    return {
      ok: false,
      error: {
        code: 'not_implemented',
        message: 'Subtask update not yet implemented in service',
      },
    };
  });

  /**
   * DELETE /subtasks/:id
   * Delete a subtask
   */
  app.delete('/subtasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Note: We need to add a deleteSubtask method to the service
    // For now, return not implemented
    reply.code(501);
    return {
      ok: false,
      error: {
        code: 'not_implemented',
        message: 'Subtask delete not yet implemented in service',
      },
    };
  });

  /**
   * PATCH /subtasks/:id/status
   * Update a subtask's status
   */
  app.patch('/subtasks/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateSubtaskStatusSchema.parse(request.body);
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

    const result = await taskService.updateSubtaskStatus(id, parsed.status);

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
   * POST /subtasks/:id/assign
   * Assign an agent to a subtask
   */
  app.post('/subtasks/:id/assign', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = assignSubtaskSchema.parse(request.body);
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

    const result = await taskService.assignSubtaskAgent(id, parsed.agentId);

    if (result.ok) {
      return { ok: true, data: result.data };
    } else {
      if (result.error.code === 'subtask.not_found') {
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
   * POST /subtasks/:id/result
   * Set a subtask's result
   */
  app.post('/subtasks/:id/result', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = setSubtaskResultSchema.parse(request.body);
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

    const result = await taskService.setSubtaskResult(id, parsed.result);

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
