import { eq, and } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

/**
 * Task agents repository
 *
 * Provides data access methods for task-agent assignments.
 */
export class TaskAgentsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Assign an agent to a task
   */
  async assign(input: {
    taskId: string;
    agentId: string;
    role?: schema.AgentRole;
  }): Promise<schema.TaskAgent> {
    const [assignment] = await this.db.insert(schema.taskAgents).values({
      taskId: input.taskId,
      agentId: input.agentId,
      role: input.role ?? 'primary',
      assignedAt: new Date(),
    }).returning();

    return assignment!;
  }

  /**
   * Assign multiple agents to a task
   */
  async assignMultiple(
    taskId: string,
    agents: Array<{ agentId: string; role?: schema.AgentRole }>
  ): Promise<schema.TaskAgent[]> {
    const assignments = agents.map((agent) => ({
      taskId,
      agentId: agent.agentId,
      role: agent.role ?? ('primary' as schema.AgentRole),
      assignedAt: new Date(),
    }));

    return this.db.insert(schema.taskAgents).values(assignments).returning();
  }

  /**
   * List all agents assigned to a task
   */
  async listByTask(taskId: string): Promise<schema.TaskAgent[]> {
    return this.db.select()
      .from(schema.taskAgents)
      .where(eq(schema.taskAgents.taskId, taskId));
  }

  /**
   * List all tasks assigned to an agent
   */
  async listByAgent(agentId: string): Promise<schema.TaskAgent[]> {
    return this.db.select()
      .from(schema.taskAgents)
      .where(eq(schema.taskAgents.agentId, agentId));
  }

  /**
   * Remove an agent from a task
   */
  async remove(taskId: string, agentId: string): Promise<schema.TaskAgent | null> {
    const results = await this.db.delete(schema.taskAgents)
      .where(and(
        eq(schema.taskAgents.taskId, taskId),
        eq(schema.taskAgents.agentId, agentId)
      ))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Remove all agents from a task
   */
  async removeAllFromTask(taskId: string): Promise<schema.TaskAgent[]> {
    return this.db.delete(schema.taskAgents)
      .where(eq(schema.taskAgents.taskId, taskId))
      .returning();
  }

  /**
   * Update an agent's role on a task
   */
  async updateRole(
    taskId: string,
    agentId: string,
    role: schema.AgentRole
  ): Promise<schema.TaskAgent | null> {
    const results = await this.db.update(schema.taskAgents)
      .set({ role })
      .where(and(
        eq(schema.taskAgents.taskId, taskId),
        eq(schema.taskAgents.agentId, agentId)
      ))
      .returning();

    return results[0] ?? null;
  }
}

/**
 * Create a task agents repository instance
 */
export function createTaskAgentsRepository(db: Database): TaskAgentsRepository {
  return new TaskAgentsRepository(db);
}
