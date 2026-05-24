import { pgTable, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { tasks } from './tasks';

/**
 * Deliverable type enum
 */
export const deliverableTypeEnum = pgEnum('deliverable_type', [
  'document',
  'image',
  'code',
  'report',
  'data',
  'link',
  'other',
]);

/**
 * Deliverable status enum
 */
export const deliverableStatusEnum = pgEnum('deliverable_status', [
  'pending',
  'delivered',
  'verified',
]);

/**
 * Deliverables table
 *
 * Represents the expected output/outputs of a task.
 * A task can have multiple deliverables (1:many relationship).
 */
export const deliverables = pgTable(
  'deliverables',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    type: deliverableTypeEnum('type').notNull(),
    description: text('description').notNull(),
    status: deliverableStatusEnum('status').notNull().default('pending'),
    format: text('format'),
    size: text('size'),
    path: text('path'),
    url: text('url'),
    version: text('version'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    taskIdIdx: index('deliverables_task_id_idx').on(table.taskId),
  }),
);

// Type exports
export type Deliverable = typeof deliverables.$inferSelect;
export type NewDeliverable = typeof deliverables.$inferInsert;
export type DeliverableType = (typeof deliverableTypeEnum.enumValues)[number];
export type DeliverableStatus =
  (typeof deliverableStatusEnum.enumValues)[number];
