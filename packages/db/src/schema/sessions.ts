import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import {
  SESSION_TYPE_VALUES,
  SESSION_STATUS_VALUES,
  MESSAGE_ROLE_VALUES,
  RUN_STATUS_VALUES,
  FINISH_REASON_VALUES,
  type SessionType,
  type SessionStatus,
  type MessageRole,
  type RunStatus,
  type FinishReason,
} from '@openaidy/shared-types';

// Re-export types from shared-types (types don't exist at runtime, only values do)
export type {
  SessionType,
  SessionStatus,
  MessageRole,
  RunStatus,
  FinishReason,
};

/**
 * Session type enum
 *
 * Distinguishes the purpose of a session:
 * - chat: regular conversation session
 * - task: task execution session
 * - subtask: subtask execution session
 */
export const sessionTypeEnum = pgEnum('session_type', SESSION_TYPE_VALUES);

/**
 * Session status enum
 */
export const sessionStatusEnum = pgEnum(
  'session_status',
  SESSION_STATUS_VALUES,
);

/**
 * Sessions table
 *
 * Stable logical conversation or execution container.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  // Session type to distinguish between chat, task, and subtask sessions
  type: sessionTypeEnum('type').notNull().default('chat'),
  status: sessionStatusEnum('status').notNull().default('active'),
  // Last agent used in this session (derived from latest run's agentId)
  // This allows session to "remember" which agent was last used
  agentId: text('agent_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  // When the session was favorited/pinned by the user (null = not a favorite).
  // Favoriting deliberately does NOT bump `updatedAt` so it never affects
  // recency ordering.
  favoritedAt: timestamp('favorited_at', { withTimezone: true }),
});

/**
 * Message role enum
 */
export const messageRoleEnum = pgEnum('message_role', MESSAGE_ROLE_VALUES);

/**
 * Session messages table
 *
 * Immutable transcript entries for sessions.
 * Uses append-only semantics with deterministic ordering via sequence number.
 */
export const sessionMessages = pgTable(
  'session_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // The run that generated this message (null for manually added messages)
    runId: text('run_id').references(() => sessionRuns.id, {
      onDelete: 'set null',
    }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    // For tool messages, identifies which tool call this responds to
    toolCallId: text('tool_call_id'),
    // For assistant messages in thinking mode (e.g., DeepSeek), stores the reasoning content
    reasoningContent: text('reasoning_content'),
    // Deterministic ordering within a session
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Optional metadata (e.g., token counts, model info)
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => ({
    runIdIdx: index('session_messages_run_id_idx').on(table.runId),
  }),
);

/**
 * Message attachments table
 *
 * Binary media (images/audio) associated with session messages. Only
 * metadata lives here — the bytes are written to local disk and referenced
 * via `storagePath`. Rows are created unlinked (`messageId` null) when a
 * user uploads a file, then linked to the user message at submit time;
 * tool-produced media (e.g. screenshots) is linked directly to the tool
 * result message.
 */
export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // Null until the attachment is linked to a persisted message
    messageId: text('message_id').references(() => sessionMessages.id, {
      onDelete: 'cascade',
    }),
    // 'image' | 'audio'
    kind: text('kind').notNull(),
    // 'user_upload' | 'tool_output'
    source: text('source').notNull().default('user_upload'),
    // Original filename (uploads) or generated name (tool output)
    name: text('name'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Absolute path of the stored bytes on local disk
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messageIdIdx: index('message_attachments_message_id_idx').on(
      table.messageId,
    ),
    sessionIdIdx: index('message_attachments_session_id_idx').on(
      table.sessionId,
    ),
  }),
);

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
export const runStatusEnum = pgEnum('run_status', RUN_STATUS_VALUES);

/**
 * Finish reason enum
 */
export const finishReasonEnum = pgEnum('finish_reason', FINISH_REASON_VALUES);

/**
 * Session runs table
 *
 * Tracks provider invocations associated with sessions.
 * Designed to support multiple concurrent runs across different sessions.
 */
export const sessionRuns = pgTable('session_runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  // Agent that executed this run
  agentId: text('agent_id').notNull(),
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
  // Prompt-cache token counts (subset of promptTokens; provider-dependent)
  cacheReadTokens: integer('cache_read_tokens'),
  cacheCreationTokens: integer('cache_creation_tokens'),
  // Estimated cost in USD (null when pricing for the model is unknown)
  cost: doublePrecision('cost'),
  // Timestamps
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // ID of the first assistant message produced by this run
  firstMessageId: text('first_message_id'),
  // Optional metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

// Type exports - inferSelect/inferInsert are schema-specific, other types from shared-types
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionMessage = typeof sessionMessages.$inferSelect;
export type NewSessionMessage = typeof sessionMessages.$inferInsert;
export type SessionRun = typeof sessionRuns.$inferSelect;
export type NewSessionRun = typeof sessionRuns.$inferInsert;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;

/** Attachment media kind */
export type AttachmentKind = 'image' | 'audio' | 'video';
/** How the attachment entered the system */
export type AttachmentSource = 'user_upload' | 'tool_output';
