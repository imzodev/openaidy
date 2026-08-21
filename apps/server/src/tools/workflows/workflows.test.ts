import { describe, it, expect, vi } from 'vitest';
import {
  createWorkflowApplyTemplateTool,
  createWorkflowCreateTool,
  createWorkflowDeleteTool,
  createWorkflowExecuteTool,
  createWorkflowGetTool,
  createWorkflowListTool,
  createWorkflowTools,
  createWorkflowUpdateTool,
} from './index';
import type { TaskService } from '../../tasks/service';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

/**
 * Build a TaskService stub with every method the workflow_* tools call.
 * Each method starts as a vi.fn() that rejects so a test must opt into
 * the behaviour it expects — a missing override surfaces immediately as
 * a thrown "not implemented" rather than a silent `undefined.ok` crash.
 */
function makeTaskServiceMock(): {
  service: TaskService;
  getTask: ReturnType<typeof vi.fn>;
  getTaskWithDetails: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
  updateTask: ReturnType<typeof vi.fn>;
  updateTaskStatus: ReturnType<typeof vi.fn>;
  deleteTask: ReturnType<typeof vi.fn>;
  listSubtaskEdges: ReturnType<typeof vi.fn>;
  applyWorkflowTemplate: ReturnType<typeof vi.fn>;
  executeSubtask: ReturnType<typeof vi.fn>;
  executeSubtasks: ReturnType<typeof vi.fn>;
  getSubtasks: ReturnType<typeof vi.fn>;
  deleteSubtask: ReturnType<typeof vi.fn>;
  listTasks: ReturnType<typeof vi.fn>;
} {
  const notImplemented = () =>
    Promise.reject(new Error('method not stubbed in this test'));
  const getTask = vi.fn(notImplemented);
  const getTaskWithDetails = vi.fn(notImplemented);
  const createTask = vi.fn(notImplemented);
  const updateTask = vi.fn(notImplemented);
  const updateTaskStatus = vi.fn(notImplemented);
  const deleteTask = vi.fn(notImplemented);
  const listSubtaskEdges = vi.fn(notImplemented);
  const applyWorkflowTemplate = vi.fn(notImplemented);
  const executeSubtask = vi.fn(notImplemented);
  const executeSubtasks = vi.fn(notImplemented);
  const getSubtasks = vi.fn(notImplemented);
  const deleteSubtask = vi.fn(notImplemented);
  const listTasks = vi.fn(notImplemented);

  const service = {
    getTask,
    getTaskWithDetails,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    listSubtaskEdges,
    applyWorkflowTemplate,
    executeSubtask,
    executeSubtasks,
    getSubtasks,
    deleteSubtask,
    listTasks,
  } as unknown as TaskService;

  return {
    service,
    getTask,
    getTaskWithDetails,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    listSubtaskEdges,
    applyWorkflowTemplate,
    executeSubtask,
    executeSubtasks,
    getSubtasks,
    deleteSubtask,
    listTasks,
  };
}

function workflowTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    title: 'Workflow',
    description: 'desc',
    status: 'todo',
    priority: 'medium',
    planningEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [],
    subtasks: [],
    ...overrides,
  };
}

describe('createWorkflowTools', () => {
  it('returns the thirteen workflow tools (workflow + nodes + edges)', () => {
    const tools = createWorkflowTools(() => undefined);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'workflow_get',
      'workflow_list',
      'workflow_create',
      'workflow_update',
      'workflow_delete',
      'workflow_execute',
      'workflow_apply_template',
      'workflow_node_create',
      'workflow_node_update',
      'workflow_node_delete',
      'workflow_edge_create',
      'workflow_edge_update',
      'workflow_edge_delete',
    ]);
  });
});

// ── workflow_create ──────────────────────────────────────────────────────────

describe('workflow_create', () => {
  it('forces planningEnabled=true AND suppresses the auto-planner', async () => {
    const mocks = makeTaskServiceMock();
    mocks.createTask.mockResolvedValue({
      ok: true,
      data: {
        id: 'wf-1',
        title: 'Auto title',
        description: 'desc',
        status: 'todo',
        priority: 'medium',
      },
    });

    const tool = createWorkflowCreateTool(() => mocks.service);
    const result = await tool.execute({ description: 'desc' }, CTX);

    expect(result.ok).toBe(true);
    // planningEnabled = true so workflow_* tools accept the task; skipAutoPlan
    // = true so TaskOperations.createTask does NOT fire the LLM planner in the
    // background and clobber the graph we are about to build.
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ planningEnabled: true, skipAutoPlan: true }),
    );
  });

  it('derives a title from the description when title is omitted', async () => {
    const mocks = makeTaskServiceMock();
    mocks.createTask.mockResolvedValue({
      ok: true,
      data: {
        id: 'wf-1',
        title: 'Derived',
        description: 'desc',
        status: 'todo',
        priority: 'medium',
      },
    });

    const tool = createWorkflowCreateTool(() => mocks.service);
    await tool.execute({ description: 'desc' }, CTX);

    expect(mocks.createTask.mock.calls[0]?.[0]).toMatchObject({
      title: 'desc',
      description: 'desc',
    });
  });

  it('truncates a very long description to derive the title', async () => {
    const mocks = makeTaskServiceMock();
    mocks.createTask.mockResolvedValue({
      ok: true,
      data: {
        id: 'wf-1',
        title: 'short',
        description: 'x',
        status: 'todo',
        priority: 'medium',
      },
    });

    const longDesc = 'a'.repeat(80);
    const tool = createWorkflowCreateTool(() => mocks.service);
    await tool.execute({ description: longDesc }, CTX);

    expect(mocks.createTask.mock.calls[0]?.[0]).toMatchObject({
      description: longDesc,
    });
    const title = (mocks.createTask.mock.calls[0]?.[0] as { title: string })
      .title;
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
  });

  it('applies a template atomically when templateId is provided', async () => {
    const mocks = makeTaskServiceMock();
    mocks.createTask.mockResolvedValue({
      ok: true,
      data: {
        id: 'wf-1',
        title: 't',
        description: 'd',
        status: 'todo',
        priority: 'medium',
      },
    });
    mocks.applyWorkflowTemplate.mockResolvedValue({
      ok: true,
      data: { nodeCount: 5, edgeCount: 4 },
    });

    const tool = createWorkflowCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        description: 'd',
        templateId: 'software-development',
        templateInputs: { projectName: 'Foo' },
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.applyWorkflowTemplate).toHaveBeenCalledWith(
      'wf-1',
      'software-development',
      { projectName: 'Foo' },
    );
    if (result.ok) {
      expect(result.content).toContain('Nodes created: 5');
      expect(result.content).toContain('Edges created: 4');
    }
  });

  it('rolls back the workflow when the template application fails', async () => {
    const mocks = makeTaskServiceMock();
    mocks.createTask.mockResolvedValue({
      ok: true,
      data: {
        id: 'wf-1',
        title: 't',
        description: 'd',
        status: 'todo',
        priority: 'medium',
      },
    });
    mocks.applyWorkflowTemplate.mockResolvedValue({
      ok: false,
      error: { code: 'template.not_found', message: 'no such template' },
    });
    mocks.deleteTask.mockResolvedValue({ ok: true, data: true });

    const tool = createWorkflowCreateTool(() => mocks.service);
    const result = await tool.execute(
      { description: 'd', templateId: 'broken' },
      CTX,
    );

    expect(result.ok).toBe(false);
    expect(mocks.deleteTask).toHaveBeenCalledWith('wf-1');
    if (!result.ok) {
      expect(result.error).toMatch(/Rolled back/);
    }
  });

  it('rejects non-string templateInputs entries', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        description: 'd',
        templateId: 'x',
        templateInputs: { foo: 42 },
      },
      CTX,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/templateInputs\["foo"\]/);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('returns the service-unavailable failure when no service is wired', async () => {
    const tool = createWorkflowCreateTool(() => undefined);
    const result = await tool.execute({ description: 'd' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Task service is not available/);
  });

  it('returns error when description is missing', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowCreateTool(() => mocks.service);
    const result = await tool.execute({}, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});

// ── workflow_update ──────────────────────────────────────────────────────────

describe('workflow_update', () => {
  it('updates the requested fields and returns the refreshed task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.updateTask.mockResolvedValue({
      ok: true,
      data: workflowTask({ title: 'New title' }),
    });

    const tool = createWorkflowUpdateTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', title: 'New title' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.updateTask).toHaveBeenCalledWith('wf-1', {
      title: 'New title',
    });
  });

  it('routes status updates through updateTaskStatus', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.updateTaskStatus.mockResolvedValue({
      ok: true,
      data: workflowTask({ status: 'done' }),
    });

    const tool = createWorkflowUpdateTool(() => mocks.service);
    await tool.execute({ workflowId: 'wf-1', status: 'done' }, CTX);

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('wf-1', 'done');
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it('rejects updates to tasks that are not workflows', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowUpdateTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1', title: 'X' }, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a workflow/);
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it('returns error when no fields are provided', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowUpdateTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1' }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it('rejects an out-of-enum priority', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowUpdateTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', priority: 'critical' },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/priority must be one of/);
  });
});

// ── workflow_delete ──────────────────────────────────────────────────────────

describe('workflow_delete', () => {
  it('deletes a workflow when confirm is true', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.deleteTask.mockResolvedValue({ ok: true, data: true });

    const tool = createWorkflowDeleteTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', confirm: true },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.deleteTask).toHaveBeenCalledWith('wf-1');
  });

  it('refuses when confirm is not true', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowDeleteTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1' }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it('refuses to delete a non-workflow task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowDeleteTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', confirm: true },
      CTX,
    );

    expect(result.ok).toBe(false);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });
});

// ── workflow_execute ─────────────────────────────────────────────────────────

describe('workflow_execute', () => {
  it('starts every ready node when no subtaskId is provided', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.executeSubtasks.mockResolvedValue({
      ok: true,
      data: { startedCount: 3 },
    });

    const tool = createWorkflowExecuteTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1' }, CTX);

    expect(result.ok).toBe(true);
    expect(mocks.executeSubtasks).toHaveBeenCalledWith('wf-1');
    if (result.ok) {
      expect(result.content).toContain('Started 3');
    }
  });

  it('executes a single node when subtaskId is provided', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.executeSubtask.mockResolvedValue({
      ok: true,
      data: { sessionId: 'sess-42' },
    });

    const tool = createWorkflowExecuteTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', subtaskId: 'sub-1' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.executeSubtask).toHaveBeenCalledWith('sub-1');
    expect(mocks.executeSubtasks).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.content).toContain('sess-42');
    }
  });

  it('rejects when the workflow has planningEnabled=false', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowExecuteTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1' }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.executeSubtasks).not.toHaveBeenCalled();
  });
});

// ── workflow_apply_template ──────────────────────────────────────────────────

describe('workflow_apply_template', () => {
  it('applies the template against an existing workflow', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.applyWorkflowTemplate.mockResolvedValue({
      ok: true,
      data: { nodeCount: 4, edgeCount: 3 },
    });

    const tool = createWorkflowApplyTemplateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        templateId: 'software-development',
        templateInputs: { projectName: 'Foo' },
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.applyWorkflowTemplate).toHaveBeenCalledWith(
      'wf-1',
      'software-development',
      { projectName: 'Foo' },
    );
    if (result.ok) {
      expect(result.content).toContain('Nodes created: 4');
      expect(result.content).toContain('Edges created: 3');
    }
  });

  it('clears existing subtasks first when clearExisting=true', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.getSubtasks.mockResolvedValue([
      {
        id: 'sub-old',
        title: 'old',
        description: 'x',
        dependsOnSubtaskIds: [],
      },
      {
        id: 'sub-old-2',
        title: 'old2',
        description: 'y',
        dependsOnSubtaskIds: [],
      },
    ]);
    mocks.deleteSubtask.mockResolvedValue({ ok: true, data: true });
    mocks.applyWorkflowTemplate.mockResolvedValue({
      ok: true,
      data: { nodeCount: 2, edgeCount: 1 },
    });

    const tool = createWorkflowApplyTemplateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        templateId: 'software-development',
        clearExisting: true,
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.deleteSubtask).toHaveBeenCalledTimes(2);
    expect(mocks.deleteSubtask).toHaveBeenCalledWith('sub-old');
    expect(mocks.deleteSubtask).toHaveBeenCalledWith('sub-old-2');
    if (result.ok) {
      expect(result.content).toMatch(/Existing nodes\/edges were cleared/);
    }
  });

  it('does not call deleteSubtask when clearExisting is false', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.applyWorkflowTemplate.mockResolvedValue({
      ok: true,
      data: { nodeCount: 2, edgeCount: 1 },
    });

    const tool = createWorkflowApplyTemplateTool(() => mocks.service);
    await tool.execute(
      { workflowId: 'wf-1', templateId: 'software-development' },
      CTX,
    );

    expect(mocks.getSubtasks).not.toHaveBeenCalled();
    expect(mocks.deleteSubtask).not.toHaveBeenCalled();
  });

  it('rejects application to non-workflow tasks', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowApplyTemplateTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', templateId: 'x' },
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(mocks.applyWorkflowTemplate).not.toHaveBeenCalled();
  });
});

// ── workflow_get ─────────────────────────────────────────────────────────────

describe('workflow_get', () => {
  it('returns metadata, nodes, and edges by default', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTaskWithDetails.mockResolvedValue(
      workflowTask({
        subtasks: [
          {
            id: 'sub-1',
            title: 'A',
            description: 'a',
            orderIndex: 0,
            subtaskKind: 'regular',
            dependsOnSubtaskIds: [],
            status: 'pending',
          },
        ],
      }),
    );
    mocks.listSubtaskEdges.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'edge-1',
          subtaskId: 'sub-1',
          dependsOnSubtaskId: 'sub-0',
          edgeKind: 'dependency',
          conditionOperator: null,
          conditionValue: null,
          createdAt: new Date(),
        },
      ],
    });

    const tool = createWorkflowGetTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1' }, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed.workflow.id).toBe('wf-1');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].fromNodeId).toBe('sub-0');
    expect(parsed.edges[0].toNodeId).toBe('sub-1');
  });

  it('omits nodes and edges when the flags are false', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTaskWithDetails.mockResolvedValue(
      workflowTask({
        subtasks: [
          {
            id: 'sub-1',
            title: 'A',
            description: 'a',
            orderIndex: 0,
            subtaskKind: 'regular',
            dependsOnSubtaskIds: [],
            status: 'pending',
          },
        ],
      }),
    );

    const tool = createWorkflowGetTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', includeNodes: false, includeEdges: false },
      CTX,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed.nodes).toBeUndefined();
    expect(parsed.edges).toBeUndefined();
    expect(mocks.listSubtaskEdges).not.toHaveBeenCalled();
  });

  it('rejects when the task is not a workflow', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTaskWithDetails.mockResolvedValue(
      workflowTask({ planningEnabled: false, subtasks: [] }),
    );

    const tool = createWorkflowGetTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'wf-1' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a workflow/);
  });

  it('returns not-found when the workflow does not exist', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTaskWithDetails.mockResolvedValue(null);

    const tool = createWorkflowGetTool(() => mocks.service);
    const result = await tool.execute({ workflowId: 'ghost' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/);
  });
});

// ── workflow_list ────────────────────────────────────────────────────────────

describe('workflow_list', () => {
  function makeTask(overrides: Record<string, unknown> = {}) {
    return {
      id: 'wf-1',
      title: 'Workflow 1',
      description: 'desc',
      status: 'todo' as const,
      priority: 'medium' as const,
      planningEnabled: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      ...overrides,
    };
  }

  it('returns only tasks with planningEnabled=true', async () => {
    const mocks = makeTaskServiceMock();
    mocks.listTasks.mockResolvedValue([
      makeTask({ id: 'wf-1' }),
      makeTask({
        id: 'task-2',
        title: 'Regular task',
        planningEnabled: false,
      }),
      makeTask({ id: 'wf-3', title: 'Another workflow' }),
    ]);

    const tool = createWorkflowListTool(() => mocks.service);
    const result = await tool.execute({}, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed.count).toBe(2);
    expect(parsed.workflows.map((w: { id: string }) => w.id)).toEqual([
      'wf-1',
      'wf-3',
    ]);
  });

  it('passes the status filter through to listTasks', async () => {
    const mocks = makeTaskServiceMock();
    mocks.listTasks.mockResolvedValue([]);

    const tool = createWorkflowListTool(() => mocks.service);
    await tool.execute({ status: 'in_progress' }, CTX);

    expect(mocks.listTasks).toHaveBeenCalledWith('in_progress');
  });

  it('caps the response at the requested limit', async () => {
    const mocks = makeTaskServiceMock();
    const many = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `wf-${i}` }),
    );
    mocks.listTasks.mockResolvedValue(many);

    const tool = createWorkflowListTool(() => mocks.service);
    const result = await tool.execute({ limit: 3 }, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed.workflows).toHaveLength(3);
  });

  it('rejects an out-of-enum status', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowListTool(() => mocks.service);
    const result = await tool.execute({ status: 'archived' }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.listTasks).not.toHaveBeenCalled();
  });

  it('returns empty array when no workflows exist', async () => {
    const mocks = makeTaskServiceMock();
    mocks.listTasks.mockResolvedValue([]);

    const tool = createWorkflowListTool(() => mocks.service);
    const result = await tool.execute({}, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed.count).toBe(0);
    expect(parsed.workflows).toEqual([]);
  });
});
