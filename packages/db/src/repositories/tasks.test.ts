import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as sessionSchema from '../schema/sessions';
import * as tasksSchema from '../schema/tasks';
import { TasksRepository } from './tasks';
import { SubtasksRepository } from './subtasks';
import { TaskAgentsRepository } from './task-agents';

// Combined schema type
type CombinedSchema = typeof sessionSchema & typeof tasksSchema;
type Database = NodePgDatabase<CombinedSchema>;

/**
 * Integration tests for tasks repositories
 *
 * These tests require a PostgreSQL database. Set DATABASE_URL to run.
 */
describe('Tasks Repositories (integration)', () => {
  // Skip tests if no DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;

  let pool: Pool | undefined;
  let db: Database | undefined;
  let tasksRepo: TasksRepository | undefined;
  let subtasksRepo: SubtasksRepository | undefined;
  let taskAgentsRepo: TaskAgentsRepository | undefined;

  beforeEach(async () => {
    if (!shouldRun || !databaseUrl) return;

    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, {
      schema: { ...sessionSchema, ...tasksSchema },
    }) as Database;

    tasksRepo = new TasksRepository(db);
    subtasksRepo = new SubtasksRepository(db);
    taskAgentsRepo = new TaskAgentsRepository(db);

    // Clean up test data (order matters due to foreign keys)
    await db.delete(tasksSchema.taskAgents);
    await db.delete(tasksSchema.subtasks);
    await db.delete(tasksSchema.tasks);
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // Mark tests as skipped when no database
  const test = shouldRun ? it : it.skip;

  describe('TasksRepository', () => {
    describe('create()', () => {
      test('should create a task with all required fields', async () => {
        const task = await tasksRepo!.create({
          title: 'Test Task',
          description: 'Test description',
        });

        expect(task.id).toBeDefined();
        expect(task.title).toBe('Test Task');
        expect(task.description).toBe('Test description');
        expect(task.status).toBe('backlog');
        expect(task.priority).toBe('medium');
        expect(task.planningEnabled).toBe(false);
        expect(task.planningStatus).toBeNull();
        expect(task.createdAt).toBeInstanceOf(Date);
        expect(task.updatedAt).toBeInstanceOf(Date);
      });

      test('should create a task with planning enabled', async () => {
        const task = await tasksRepo!.create({
          title: 'Planned Task',
          description: 'This task will be planned',
          planningEnabled: true,
        });

        expect(task.planningEnabled).toBe(true);
        expect(task.planningStatus).toBe('pending');
      });

      test('should create a task with custom priority', async () => {
        const task = await tasksRepo!.create({
          title: 'Urgent Task',
          description: 'High priority task',
          priority: 'urgent',
        });

        expect(task.priority).toBe('urgent');
      });
    });

    describe('findById()', () => {
      test('should return task when exists', async () => {
        const created = await tasksRepo!.create({
          title: 'Find Me',
          description: 'Test description',
        });

        const found = await tasksRepo!.findById(created.id);

        expect(found).toBeDefined();
        expect(found?.id).toBe(created.id);
        expect(found?.title).toBe('Find Me');
      });

      test('should return null when not found', async () => {
        const found = await tasksRepo!.findById('nonexistent-id');
        expect(found).toBeNull();
      });
    });

    describe('list()', () => {
      test('should return all tasks when no status filter', async () => {
        await tasksRepo!.create({ title: 'Task 1', description: 'D1' });
        await tasksRepo!.create({ title: 'Task 2', description: 'D2' });

        const tasks = await tasksRepo!.list();
        expect(tasks.length).toBeGreaterThanOrEqual(2);
      });

      test('should filter by status', async () => {
        await tasksRepo!.create({ title: 'Backlog Task', description: 'D1' });
        const inProgressTask = await tasksRepo!.create({
          title: 'Progress Task',
          description: 'D2',
        });
        await tasksRepo!.updateStatus(inProgressTask.id, 'in_progress');

        const backlogTasks = await tasksRepo!.list('backlog');
        expect(backlogTasks.every((t) => t.status === 'backlog')).toBe(true);
      });
    });

    describe('listByStatuses()', () => {
      test('should return tasks matching any status', async () => {
        const task1 = await tasksRepo!.create({
          title: 'T1',
          description: 'D1',
        });
        const task2 = await tasksRepo!.create({
          title: 'T2',
          description: 'D2',
        });
        await tasksRepo!.updateStatus(task1.id, 'todo');
        await tasksRepo!.updateStatus(task2.id, 'in_progress');

        const tasks = await tasksRepo!.listByStatuses(['todo', 'in_progress']);
        expect(tasks.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('update()', () => {
      test('should update task fields', async () => {
        const task = await tasksRepo!.create({
          title: 'Original Title',
          description: 'Original description',
        });

        const updated = await tasksRepo!.update(task.id, {
          title: 'Updated Title',
          description: 'Updated description',
          priority: 'high',
        });

        expect(updated?.title).toBe('Updated Title');
        expect(updated?.description).toBe('Updated description');
        expect(updated?.priority).toBe('high');
      });
    });

    describe('updateStatus()', () => {
      test('should update task status', async () => {
        const task = await tasksRepo!.create({
          title: 'Status Test',
          description: 'Test',
        });

        const updated = await tasksRepo!.updateStatus(task.id, 'in_progress');

        expect(updated?.status).toBe('in_progress');
      });
    });

    describe('updatePlanningStatus()', () => {
      test('should update planning status', async () => {
        const task = await tasksRepo!.create({
          title: 'Planning Test',
          description: 'Test',
          planningEnabled: true,
        });

        const updated = await tasksRepo!.updatePlanningStatus(
          task.id,
          'in_progress',
        );

        expect(updated?.planningStatus).toBe('in_progress');
      });
    });

    describe('delete()', () => {
      test('should delete a task', async () => {
        const task = await tasksRepo!.create({
          title: 'To Delete',
          description: 'Will be deleted',
        });

        await tasksRepo!.delete(task.id);

        const found = await tasksRepo!.findById(task.id);
        expect(found).toBeNull();
      });

      test('should cascade delete subtasks and agents', async () => {
        const task = await tasksRepo!.create({
          title: 'Task with subtasks',
          description: 'Test',
        });

        const subtask = await subtasksRepo!.create({
          taskId: task.id,
          title: 'Subtask',
          description: 'Test subtask',
        });

        await taskAgentsRepo!.assign({
          taskId: task.id,
          agentId: 'agent-1',
        });

        await tasksRepo!.delete(task.id);

        const foundSubtask = await subtasksRepo!.findById(subtask.id);
        expect(foundSubtask).toBeNull();

        const agents = await taskAgentsRepo!.listByTask(task.id);
        expect(agents).toHaveLength(0);
      });
    });
  });

  describe('SubtasksRepository', () => {
    let taskId: string;

    beforeEach(async () => {
      const task = await tasksRepo!.create({
        title: 'Parent Task',
        description: 'Test',
      });
      taskId = task.id;
    });

    describe('create()', () => {
      test('should create a subtask', async () => {
        const subtask = await subtasksRepo!.create({
          taskId,
          title: 'Subtask 1',
          description: 'Subtask description',
        });

        expect(subtask.id).toBeDefined();
        expect(subtask.taskId).toBe(taskId);
        expect(subtask.title).toBe('Subtask 1');
        expect(subtask.status).toBe('pending');
        expect(subtask.orderIndex).toBe(0);
      });

      test('should create subtask with agent assignment', async () => {
        const subtask = await subtasksRepo!.create({
          taskId,
          title: 'Assigned Subtask',
          description: 'Test',
          assignedAgentId: 'agent-123',
        });

        expect(subtask.assignedAgentId).toBe('agent-123');
      });
    });

    describe('listByTask()', () => {
      test('should list all subtasks for a task', async () => {
        await subtasksRepo!.create({ taskId, title: 'S1', description: 'D1' });
        await subtasksRepo!.create({ taskId, title: 'S2', description: 'D2' });

        const subtasks = await subtasksRepo!.listByTask(taskId);
        expect(subtasks).toHaveLength(2);
      });
    });

    describe('updateStatus()', () => {
      test('should update subtask status', async () => {
        const subtask = await subtasksRepo!.create({
          taskId,
          title: 'Test',
          description: 'Test',
        });

        const updated = await subtasksRepo!.updateStatus(
          subtask.id,
          'in_progress',
        );

        expect(updated?.status).toBe('in_progress');
      });
    });

    describe('assignAgent()', () => {
      test('should assign agent and set status to assigned', async () => {
        const subtask = await subtasksRepo!.create({
          taskId,
          title: 'Test',
          description: 'Test',
        });

        const updated = await subtasksRepo!.assignAgent(
          subtask.id,
          'agent-456',
        );

        expect(updated?.assignedAgentId).toBe('agent-456');
        expect(updated?.status).toBe('assigned');
      });
    });

    describe('setResult()', () => {
      test('should set subtask result', async () => {
        const subtask = await subtasksRepo!.create({
          taskId,
          title: 'Test',
          description: 'Test',
        });

        const updated = await subtasksRepo!.setResult(
          subtask.id,
          'Task completed successfully',
        );

        expect(updated?.result).toBe('Task completed successfully');
      });
    });

    describe('getCountsByStatus()', () => {
      test('should return counts by status', async () => {
        const s1 = await subtasksRepo!.create({
          taskId,
          title: 'S1',
          description: 'D1',
        });
        const s2 = await subtasksRepo!.create({
          taskId,
          title: 'S2',
          description: 'D2',
        });
        const s3 = await subtasksRepo!.create({
          taskId,
          title: 'S3',
          description: 'D3',
        });

        await subtasksRepo!.updateStatus(s1.id, 'completed');
        await subtasksRepo!.updateStatus(s2.id, 'completed');
        await subtasksRepo!.updateStatus(s3.id, 'in_progress');

        const counts = await subtasksRepo!.getCountsByStatus(taskId);

        expect(counts.pending).toBe(0);
        expect(counts.completed).toBe(2);
        expect(counts.in_progress).toBe(1);
      });
    });
  });

  describe('TaskAgentsRepository', () => {
    let taskId: string;

    beforeEach(async () => {
      const task = await tasksRepo!.create({
        title: 'Agent Task',
        description: 'Test',
      });
      taskId = task.id;
    });

    describe('assign()', () => {
      test('should assign agent to task', async () => {
        const assignment = await taskAgentsRepo!.assign({
          taskId,
          agentId: 'agent-1',
        });

        expect(assignment.taskId).toBe(taskId);
        expect(assignment.agentId).toBe('agent-1');
        expect(assignment.role).toBe('primary');
      });

      test('should assign agent with specific role', async () => {
        const assignment = await taskAgentsRepo!.assign({
          taskId,
          agentId: 'agent-2',
          role: 'reviewer',
        });

        expect(assignment.role).toBe('reviewer');
      });
    });

    describe('assignMultiple()', () => {
      test('should assign multiple agents at once', async () => {
        const assignments = await taskAgentsRepo!.assignMultiple(taskId, [
          { agentId: 'agent-1', role: 'primary' },
          { agentId: 'agent-2', role: 'secondary' },
          { agentId: 'agent-3', role: 'reviewer' },
        ]);

        expect(assignments).toHaveLength(3);
      });
    });

    describe('listByTask()', () => {
      test('should list all agents for a task', async () => {
        await taskAgentsRepo!.assignMultiple(taskId, [
          { agentId: 'agent-1' },
          { agentId: 'agent-2' },
        ]);

        const agents = await taskAgentsRepo!.listByTask(taskId);
        expect(agents).toHaveLength(2);
      });
    });

    describe('listByAgent()', () => {
      test('should list all tasks for an agent', async () => {
        const task2 = await tasksRepo!.create({
          title: 'Another Task',
          description: 'Test',
        });

        await taskAgentsRepo!.assign({ taskId, agentId: 'agent-123' });
        await taskAgentsRepo!.assign({
          taskId: task2.id,
          agentId: 'agent-123',
        });

        const tasks = await taskAgentsRepo!.listByAgent('agent-123');
        expect(tasks).toHaveLength(2);
      });
    });

    describe('remove()', () => {
      test('should remove agent from task', async () => {
        await taskAgentsRepo!.assign({ taskId, agentId: 'agent-to-remove' });

        await taskAgentsRepo!.remove(taskId, 'agent-to-remove');

        const agents = await taskAgentsRepo!.listByTask(taskId);
        expect(
          agents.find((a) => a.agentId === 'agent-to-remove'),
        ).toBeUndefined();
      });
    });

    describe('removeAllFromTask()', () => {
      test('should remove all agents from task', async () => {
        await taskAgentsRepo!.assignMultiple(taskId, [
          { agentId: 'agent-1' },
          { agentId: 'agent-2' },
        ]);

        await taskAgentsRepo!.removeAllFromTask(taskId);

        const agents = await taskAgentsRepo!.listByTask(taskId);
        expect(agents).toHaveLength(0);
      });
    });

    describe('updateRole()', () => {
      test('should update agent role', async () => {
        await taskAgentsRepo!.assign({
          taskId,
          agentId: 'agent-1',
          role: 'primary',
        });

        const updated = await taskAgentsRepo!.updateRole(
          taskId,
          'agent-1',
          'reviewer',
        );

        expect(updated?.role).toBe('reviewer');
      });
    });
  });
});
