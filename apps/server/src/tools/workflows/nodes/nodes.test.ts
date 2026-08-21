import { describe, it, expect, vi } from 'vitest';
import {
  createWorkflowNodeCreateTool,
  createWorkflowNodeDeleteTool,
  createWorkflowNodeUpdateTool,
} from './index';
import { createWorkflowTools } from '../index.js';
import type { TaskService } from '../../../tasks/service';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

function makeTaskServiceMock(): {
  service: TaskService;
  getTask: ReturnType<typeof vi.fn>;
  getSubtask: ReturnType<typeof vi.fn>;
  createSubtask: ReturnType<typeof vi.fn>;
  updateSubtask: ReturnType<typeof vi.fn>;
  deleteSubtask: ReturnType<typeof vi.fn>;
} {
  const notImplemented = () =>
    Promise.reject(new Error('method not stubbed in this test'));
  const getTask = vi.fn(notImplemented);
  const getSubtask = vi.fn(notImplemented);
  const createSubtask = vi.fn(notImplemented);
  const updateSubtask = vi.fn(notImplemented);
  const deleteSubtask = vi.fn(notImplemented);

  const service = {
    getTask,
    getSubtask,
    createSubtask,
    updateSubtask,
    deleteSubtask,
  } as unknown as TaskService;

  return {
    service,
    getTask,
    getSubtask,
    createSubtask,
    updateSubtask,
    deleteSubtask,
  };
}

function workflowTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    title: 'Workflow',
    planningEnabled: true,
    ...overrides,
  };
}

// ── createWorkflowTools factory: includes node tools ─────────────────────────

describe('createWorkflowTools (node tools wiring)', () => {
  it('exposes the three workflow_node_* tools alongside the workflow-level tools', () => {
    const tools = createWorkflowTools(() => undefined);
    const names = tools.map((t) => t.name);
    expect(names).toContain('workflow_node_create');
    expect(names).toContain('workflow_node_update');
    expect(names).toContain('workflow_node_delete');
  });
});

// ── workflow_node_create ─────────────────────────────────────────────────────

describe('workflow_node_create', () => {
  it('creates a node inside a workflow', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.createSubtask.mockResolvedValue({
      ok: true,
      data: {
        id: 'node-1',
        title: 'My node',
        description: 'do the thing',
        subtaskKind: 'agent',
        status: 'pending',
      },
    });

    const tool = createWorkflowNodeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        title: 'My node',
        description: 'do the thing',
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.createSubtask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'wf-1',
        title: 'My node',
        description: 'do the thing',
      }),
    );
  });

  it('passes through subtaskKind and loop when provided', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.createSubtask.mockResolvedValue({
      ok: true,
      data: {
        id: 'node-1',
        title: 't',
        description: 'd',
        subtaskKind: 'approval_gate',
        status: 'pending',
      },
    });

    const tool = createWorkflowNodeCreateTool(() => mocks.service);
    await tool.execute(
      {
        workflowId: 'wf-1',
        title: 't',
        description: 'd',
        subtaskKind: 'approval_gate',
        loop: {
          maxIterations: 3,
          conditionOperator: 'equals',
          conditionValue: 'OK',
        },
      },
      CTX,
    );

    expect(mocks.createSubtask).toHaveBeenCalledWith(
      expect.objectContaining({
        subtaskKind: 'approval_gate',
        loop: {
          maxIterations: 3,
          conditionOperator: 'equals',
          conditionValue: 'OK',
        },
      }),
    );
  });

  it('rejects non-workflow tasks', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowNodeCreateTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', title: 't', description: 'd' },
      CTX,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a workflow/);
    expect(mocks.createSubtask).not.toHaveBeenCalled();
  });

  it('rejects an out-of-enum subtaskKind before touching the service', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowNodeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        title: 't',
        description: 'd',
        subtaskKind: 'mystery',
      },
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it('rejects a malformed loop payload before touching the service', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowNodeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        title: 't',
        description: 'd',
        loop: { maxIterations: 3 },
      },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/loop.conditionOperator/);
  });

  it('returns error when title is missing', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowNodeCreateTool(() => mocks.service);
    const result = await tool.execute(
      { workflowId: 'wf-1', description: 'd' },
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });
});

// ── workflow_node_update ─────────────────────────────────────────────────────

describe('workflow_node_update', () => {
  it('updates the requested fields on a workflow node', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue({
      id: 'node-1',
      taskId: 'wf-1',
    });
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.updateSubtask.mockResolvedValue({
      ok: true,
      data: {
        id: 'node-1',
        title: 'New',
        description: 'd',
        status: 'pending',
      },
    });

    const tool = createWorkflowNodeUpdateTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'node-1', title: 'New' }, CTX);

    expect(result.ok).toBe(true);
    expect(mocks.updateSubtask).toHaveBeenCalledWith('node-1', {
      title: 'New',
    });
  });

  it('explicitly clears the loop when loop=null is passed', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue({ id: 'node-1', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.updateSubtask.mockResolvedValue({
      ok: true,
      data: { id: 'node-1', title: 't', description: 'd', status: 'pending' },
    });

    const tool = createWorkflowNodeUpdateTool(() => mocks.service);
    await tool.execute({ nodeId: 'node-1', loop: null }, CTX);

    expect(mocks.updateSubtask).toHaveBeenCalledWith('node-1', { loop: null });
  });

  it('refuses to update a node that belongs to a non-workflow task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue({ id: 'node-1', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowNodeUpdateTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'node-1', title: 'New' }, CTX);

    expect(result.ok).toBe(false);
    expect(mocks.updateSubtask).not.toHaveBeenCalled();
  });

  it('returns not-found when the node does not exist', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue(null);

    const tool = createWorkflowNodeUpdateTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'ghost', title: 'New' }, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it('rejects an empty patch (no fields provided)', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowNodeUpdateTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'node-1' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/No fields to update/);
  });
});

// ── workflow_node_delete ─────────────────────────────────────────────────────

describe('workflow_node_delete', () => {
  it('deletes a workflow node when confirm is true', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue({ id: 'node-1', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.deleteSubtask.mockResolvedValue({ ok: true, data: true });

    const tool = createWorkflowNodeDeleteTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'node-1', confirm: true }, CTX);

    expect(result.ok).toBe(true);
    expect(mocks.deleteSubtask).toHaveBeenCalledWith('node-1');
  });

  it('refuses when confirm is not true', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowNodeDeleteTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'node-1' }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.deleteSubtask).not.toHaveBeenCalled();
  });

  it('refuses to delete a node that belongs to a non-workflow task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue({ id: 'node-1', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowNodeDeleteTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'node-1', confirm: true }, CTX);

    expect(result.ok).toBe(false);
    expect(mocks.deleteSubtask).not.toHaveBeenCalled();
  });

  it('returns not-found when the node does not exist', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtask.mockResolvedValue(null);

    const tool = createWorkflowNodeDeleteTool(() => mocks.service);
    const result = await tool.execute({ nodeId: 'ghost', confirm: true }, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/);
  });
});
