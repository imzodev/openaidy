import { pgTable, text, timestamp, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core';

/**
 * Session status enum
 */
export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'archived',
  'deleted',
]);

/**
 * Sessions table
 * 
 * Stable logical conversation or execution container.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: sessionStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

/**
 * Message role enum
 */
export const messageRoleEnum = pgEnum('message_role', [
  'system',
  'user',
  'assistant',
  'tool',
]);

/**
 * Session messages table
 * 
 * Immutable transcript entries for sessions.
 * Uses append-only semantics with deterministic ordering via sequence number.
 */
export const sessionMessages = pgTable('session_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  // For tool messages, identifies which tool call this responds to
  toolCallId: text('tool_call_id'),
  // Deterministic ordering within a session
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Optional metadata (e.g., token counts, model info)
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

/**
 * Run status enum
 * 
 * Designed to support future async execution:
 * - queued: run is waiting to be processed
 * - running: run is currently executing
 * - succeeded: run completed successfully
 * - failed: run failed with an error
 * - cancelled: run was cancelled before completion
 */
export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

/**
 * Finish reason enum
 */
export const finishReasonEnum = pgEnum('finish_reason', [
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'error',
]);

/**
 * Session runs table
 * 
 * Tracks provider invocations associated with sessions.
 * Designed to support multiple concurrent runs across different sessions.
 */
export const sessionRuns = pgTable('session_runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  // Provider and model information
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  // Run status
  status: runStatusEnum('status').notNull().default('queued'),
  finishReason: finishReasonEnum('finish_reason'),
  // Error information (when status is 'failed')
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  // Usage tracking
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  // Timestamps
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Optional metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

// Type exports
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionMessage = typeof sessionMessages.$inferSelect;
export type NewSessionMessage = typeof sessionMessages.$inferInsert;
export type SessionRun = typeof sessionRuns.$inferSelect;
export type NewSessionRun = typeof sessionRuns.$inferInsert;
export type SessionStatus = (typeof sessionStatusEnum.enumValues)[number];
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];
export type RunStatus = (typeof runStatusEnum.enumValues)[number];
export type FinishReason = (typeof finishReasonEnum.enumValues)[number];
