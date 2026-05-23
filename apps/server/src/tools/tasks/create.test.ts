import { describe, it, expect, vi } from 'vitest';
import { createTasksCreateTool } from './create';
import type { TaskService } from '../../tasks/service';

describe('tasksCreateTool', () => {
  it('returns error if TaskService is not available', async () => {
    const tool = createTasksCreateTool(() => undefined);
    const result = await tool.execute(
      { description: 'Test description' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Task service is not available');
  });

  it('calls createTask with provided arguments and returns success content', async () => {
    const mockTask = {
      id: 'task-123',
      title: 'Custom Title',
      description: 'Test description',
      status: 'todo',
      priority: 'high',
    };
    const mockCreateTask = vi.fn().mockResolvedValue({
      ok: true,
      data: mockTask,
    });
    const mockTaskService = {
      createTask: mockCreateTask,
    } as unknown as TaskService;

    const tool = createTasksCreateTool(() => mockTaskService);
    const result = await tool.execute(
      {
        title: 'Custom Title',
        description: 'Test description',
        priority: 'high',
        planningEnabled: true,
      },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('Task created successfully!');
    expect(result.content).toContain('ID: task-123');
    expect(result.content).toContain('Title: Custom Title');
    expect(result.content).toContain('Description: Test description');
    expect(result.content).toContain('Priority: high');

    expect(mockCreateTask).toHaveBeenCalledWith({
      title: 'Custom Title',
      description: 'Test description',
      priority: 'high',
      planningEnabled: true,
    });
  });

  it('handles validation error when description is missing or invalid', async () => {
    const mockTaskService = {} as unknown as TaskService;
    const tool = createTasksCreateTool(() => mockTaskService);

    const result = await tool.execute(
      { description: '' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('description is required');
  });
});
