import { describe, it, expect, vi } from 'vitest';
import {
  createWorkflowEdgeCreateTool,
  createWorkflowEdgeDeleteTool,
  createWorkflowEdgeUpdateTool,
} from './index';
import { createWorkflowTools } from '../index.js';
import type { TaskService } from '../../../tasks/service';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

function makeTaskServiceMock(): {
  service: TaskService;
  getTask: ReturnType<typeof vi.fn>;
  getSubtask: ReturnType<typeof vi.fn>;
  getSubtaskEdge: ReturnType<typeof vi.fn>;
  createSubtaskEdge: ReturnType<typeof vi.fn>;
  updateSubtaskEdge: ReturnType<typeof vi.fn>;
  deleteSubtaskEdge: ReturnType<typeof vi.fn>;
} {
  const notImplemented = () =>
    Promise.reject(new Error('method not stubbed in this test'));
  const getTask = vi.fn(notImplemented);
  const getSubtask = vi.fn(notImplemented);
  const getSubtaskEdge = vi.fn(notImplemented);
  const createSubtaskEdge = vi.fn(notImplemented);
  const updateSubtaskEdge = vi.fn(notImplemented);
  const deleteSubtaskEdge = vi.fn(notImplemented);

  const service = {
    getTask,
    getSubtask,
    getSubtaskEdge,
    createSubtaskEdge,
    updateSubtaskEdge,
    deleteSubtaskEdge,
  } as unknown as TaskService;

  return {
    service,
    getTask,
    getSubtask,
    getSubtaskEdge,
    createSubtaskEdge,
    updateSubtaskEdge,
    deleteSubtaskEdge,
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

function makeEdge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'edge-1',
    subtaskId: 'node-2',
    dependsOnSubtaskId: 'node-1',
    edgeKind: 'dependency',
    conditionOperator: null,
    conditionValue: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── createWorkflowTools factory: includes edge tools ─────────────────────────

describe('createWorkflowTools (edge tools wiring)', () => {
  it('exposes the three workflow_edge_* tools', () => {
    const tools = createWorkflowTools(() => undefined);
    const names = tools.map((t) => t.name);
    expect(names).toContain('workflow_edge_create');
    expect(names).toContain('workflow_edge_update');
    expect(names).toContain('workflow_edge_delete');
  });
});

// ── workflow_edge_create ─────────────────────────────────────────────────────

describe('workflow_edge_create', () => {
  it('creates a plain dependency edge between two nodes', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.createSubtaskEdge.mockResolvedValue({
      ok: true,
      data: makeEdge(),
    });

    const tool = createWorkflowEdgeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.createSubtaskEdge).toHaveBeenCalledWith('wf-1', {
      subtaskId: 'node-2',
      dependsOnSubtaskId: 'node-1',
    });
  });

  it('forwards edgeKind=conditional with the operator + value pair', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.createSubtaskEdge.mockResolvedValue({
      ok: true,
      data: makeEdge({ edgeKind: 'conditional' }),
    });

    const tool = createWorkflowEdgeCreateTool(() => mocks.service);
    await tool.execute(
      {
        workflowId: 'wf-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'OK',
      },
      CTX,
    );

    expect(mocks.createSubtaskEdge).toHaveBeenCalledWith('wf-1', {
      subtaskId: 'node-2',
      dependsOnSubtaskId: 'node-1',
      edgeKind: 'conditional',
      condition: { operator: 'equals', value: 'OK' },
    });
  });

  it('rejects a conditional edge that has no condition', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowEdgeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
        edgeKind: 'conditional',
      },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/conditionOperator is required/);
    expect(mocks.createSubtaskEdge).not.toHaveBeenCalled();
  });

  it('rejects condition params on a non-conditional edge', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowEdgeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
        conditionOperator: 'equals',
        conditionValue: 'OK',
      },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/only be set when edgeKind is conditional/);
  });

  it('refuses to add an edge to a non-workflow task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowEdgeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
      },
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(mocks.createSubtaskEdge).not.toHaveBeenCalled();
  });

  it('propagates the service-level cycle / self-edge rejection', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.createSubtaskEdge.mockResolvedValue({
      ok: false,
      error: {
        code: 'edge.would_create_cycle',
        message: 'Adding this edge would create a cycle in the subtask graph',
      },
    });

    const tool = createWorkflowEdgeCreateTool(() => mocks.service);
    const result = await tool.execute(
      {
        workflowId: 'wf-1',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
      },
      CTX,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cycle/);
  });
});

// ── workflow_edge_update ─────────────────────────────────────────────────────

describe('workflow_edge_update', () => {
  it('updates edgeKind and adds a condition', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(makeEdge());
    mocks.getSubtask.mockResolvedValue({ id: 'node-2', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.updateSubtaskEdge.mockResolvedValue({
      ok: true,
      data: makeEdge({
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'OK',
      }),
    });

    const tool = createWorkflowEdgeUpdateTool(() => mocks.service);
    const result = await tool.execute(
      {
        edgeId: 'edge-1',
        edgeKind: 'conditional',
        condition: { operator: 'equals', value: 'OK' },
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(mocks.updateSubtaskEdge).toHaveBeenCalledWith('edge-1', {
      edgeKind: 'conditional',
      condition: { operator: 'equals', value: 'OK' },
    });
  });

  it('passes condition: null to clear an existing condition', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(
      makeEdge({
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'OK',
      }),
    );
    mocks.getSubtask.mockResolvedValue({ id: 'node-2', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.updateSubtaskEdge.mockResolvedValue({
      ok: true,
      data: makeEdge({ edgeKind: 'dependency' }),
    });

    const tool = createWorkflowEdgeUpdateTool(() => mocks.service);
    await tool.execute({ edgeId: 'edge-1', condition: null }, CTX);

    expect(mocks.updateSubtaskEdge).toHaveBeenCalledWith('edge-1', {
      condition: null,
    });
  });

  it('rejects an empty patch', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowEdgeUpdateTool(() => mocks.service);
    const result = await tool.execute({ edgeId: 'edge-1' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/No fields to update/);
  });

  it('refuses an edge whose source subtask belongs to a non-workflow task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(makeEdge());
    mocks.getSubtask.mockResolvedValue({ id: 'node-2', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowEdgeUpdateTool(() => mocks.service);
    const result = await tool.execute(
      { edgeId: 'edge-1', edgeKind: 'dependency' },
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(mocks.updateSubtaskEdge).not.toHaveBeenCalled();
  });

  it('returns not-found when the edge does not exist', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(null);

    const tool = createWorkflowEdgeUpdateTool(() => mocks.service);
    const result = await tool.execute(
      { edgeId: 'ghost', edgeKind: 'dependency' },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/);
  });
});

// ── workflow_edge_delete ─────────────────────────────────────────────────────

describe('workflow_edge_delete', () => {
  it('deletes a workflow edge when confirm is true', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(makeEdge());
    mocks.getSubtask.mockResolvedValue({ id: 'node-2', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask());
    mocks.deleteSubtaskEdge.mockResolvedValue({ ok: true, data: true });

    const tool = createWorkflowEdgeDeleteTool(() => mocks.service);
    const result = await tool.execute({ edgeId: 'edge-1', confirm: true }, CTX);

    expect(result.ok).toBe(true);
    expect(mocks.deleteSubtaskEdge).toHaveBeenCalledWith('edge-1');
  });

  it('refuses when confirm is not true', async () => {
    const mocks = makeTaskServiceMock();
    const tool = createWorkflowEdgeDeleteTool(() => mocks.service);
    const result = await tool.execute({ edgeId: 'edge-1' }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.deleteSubtaskEdge).not.toHaveBeenCalled();
  });

  it('refuses to delete an edge on a non-workflow task', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(makeEdge());
    mocks.getSubtask.mockResolvedValue({ id: 'node-2', taskId: 'wf-1' });
    mocks.getTask.mockResolvedValue(workflowTask({ planningEnabled: false }));

    const tool = createWorkflowEdgeDeleteTool(() => mocks.service);
    const result = await tool.execute({ edgeId: 'edge-1', confirm: true }, CTX);
    expect(result.ok).toBe(false);
    expect(mocks.deleteSubtaskEdge).not.toHaveBeenCalled();
  });

  it('returns not-found when the edge does not exist', async () => {
    const mocks = makeTaskServiceMock();
    mocks.getSubtaskEdge.mockResolvedValue(null);

    const tool = createWorkflowEdgeDeleteTool(() => mocks.service);
    const result = await tool.execute({ edgeId: 'ghost', confirm: true }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/);
  });
});
