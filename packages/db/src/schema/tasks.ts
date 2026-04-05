import { pgTable, text, timestamp, integer, boolean, pgEnum } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

/**
 * Task status enum
 * - backlog: Not yet ready to work on
 * - todo: Ready to be picked up
 * - in_progress: Currently being worked on
 * - review: Awaiting review
 * - done: Completed successfully
 * - cancelled: Cancelled before completion
 */
export const taskStatusEnum = pgEnum('task_status', [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
]);

/**
 * Task priority enum
 */
export const taskPriorityEnum = pgEnum('task_priority', [
  'low',
  'medium',
  'high',
  'urgent',
]);

/**
 * Planning status enum
 * - pending: Planning not yet started
 * - in_progress: Planning agent is working
 * - completed: Planning finished, subtasks created
 * - failed: Planning failed
 */
export const planningStatusEnum = pgEnum('planning_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

/**
 * Tasks table
 *
 * Main entity for the Kanban-style task management system.
 * Tasks can optionally use a planning agent to decompose into subtasks.
 */
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: taskStatusEnum('status').notNull().default('backlog'),
  priority: taskPriorityEnum('priority').notNull().default('medium'),
  planningEnabled: boolean('planning_enabled').notNull().default(false),
  planningStatus: planningStatusEnum('planning_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Subtask status enum
 * - pending: Created but not assigned
 * - assigned: Assigned to an agent
 * - in_progress: Agent is working on it
 * - completed: Successfully completed
 * - failed: Execution failed
 */
export const subtaskStatusEnum = pgEnum('subtask_status', [
  'pending',
  'assigned',
  'in_progress',
  'completed',
  'failed',
]);

/**
 * Subtasks table
 *
 * Subtasks are created by the planning agent or manually.
 * Supports nested subtasks via parentSubtaskId.
 */
export const subtasks = pgTable('subtasks', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  parentSubtaskId: text('parent_subtask_id').references((): any => subtasks.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: subtaskStatusEnum('status').notNull().default('pending'),
  assignedAgentId: text('assigned_agent_id'),
  orderIndex: integer('order_index').notNull().default(0),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Agent role enum
 * - primary: Main agent responsible
 * - secondary: Supporting agent
 * - reviewer: Reviewing agent
 */
export const agentRoleEnum = pgEnum('agent_role', [
  'primary',
  'secondary',
  'reviewer',
]);

/**
 * Task agents junction table
 *
 * Links agents to tasks with role designation.
 * Uses composite primary key (taskId, agentId).
 */
export const taskAgents = pgTable('task_agents', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  role: agentRoleEnum('role').notNull().default('primary'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.taskId, table.agentId] }),
}));

// Type exports
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Subtask = typeof subtasks.$inferSelect;
export type NewSubtask = typeof subtasks.$inferInsert;
export type TaskAgent = typeof taskAgents.$inferSelect;
export type NewTaskAgent = typeof taskAgents.$inferInsert;

// Enum type exports
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type PlanningStatus = (typeof planningStatusEnum.enumValues)[number];
export type SubtaskStatus = (typeof subtaskStatusEnum.enumValues)[number];
export type AgentRole = (typeof agentRoleEnum.enumValues)[number];
