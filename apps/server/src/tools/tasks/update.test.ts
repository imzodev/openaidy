import { describe, it, expect, vi } from 'vitest';
import { createTasksUpdateTool } from './update';
import type { TaskService } from '../../tasks/service';

describe('tasksUpdateTool', () => {
  it('returns error if TaskService is not available', async () => {
    const tool = createTasksUpdateTool(() => undefined);
    const result = await tool.execute(
      { id: 'task-1' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Task service is not available');
  });

  it('returns error if id is missing', async () => {
    const mockTaskService = {} as unknown as TaskService;
    const tool = createTasksUpdateTool(() => mockTaskService);
    const result = await tool.execute(
      { id: '' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('id is required');
  });

  it('updates task fields and returns success content', async () => {
    const updatedTask = {
      id: 'task-1',
      title: 'Updated Title',
      description: 'Updated description',
      status: 'todo',
      priority: 'urgent',
    };
    const mockUpdateTask = vi
      .fn()
      .mockResolvedValue({ ok: true, data: updatedTask });
    const mockGetTask = vi.fn().mockResolvedValue(updatedTask);
    const mockTaskService = {
      updateTask: mockUpdateTask,
      getTask: mockGetTask,
    } as unknown as TaskService;

    const tool = createTasksUpdateTool(() => mockTaskService);
    const result = await tool.execute(
      {
        id: 'task-1',
        title: 'Updated Title',
        description: 'Updated description',
        priority: 'urgent',
      },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('Task updated successfully!');
    expect(result.content).toContain('Title: Updated Title');
    expect(result.content).toContain('Description: Updated description');
    expect(result.content).toContain('Priority: urgent');

    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', {
      title: 'Updated Title',
      description: 'Updated description',
      priority: 'urgent',
    });
  });

  it('updates task status via updateTaskStatus', async () => {
    const updatedTask = {
      id: 'task-1',
      title: 'My Task',
      description: 'Some description',
      status: 'done',
      priority: 'medium',
    };
    const mockUpdateTaskStatus = vi
      .fn()
      .mockResolvedValue({ ok: true, data: updatedTask });
    const mockGetTask = vi.fn().mockResolvedValue(updatedTask);
    const mockTaskService = {
      updateTaskStatus: mockUpdateTaskStatus,
      getTask: mockGetTask,
    } as unknown as TaskService;

    const tool = createTasksUpdateTool(() => mockTaskService);
    const result = await tool.execute(
      { id: 'task-1', status: 'done' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('Status: done');

    expect(mockUpdateTaskStatus).toHaveBeenCalledWith('task-1', 'done');
  });

  it('returns error when updateTask fails', async () => {
    const mockUpdateTask = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'task.not_found', message: 'Task "task-999" not found' },
    });
    const mockTaskService = {
      updateTask: mockUpdateTask,
    } as unknown as TaskService;

    const tool = createTasksUpdateTool(() => mockTaskService);
    const result = await tool.execute(
      { id: 'task-999', title: 'New Title' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not found');
  });

  it('tool definition has correct name', () => {
    const tool = createTasksUpdateTool(() => undefined);
    expect(tool.name).toBe('tasks_update');
  });
});
