/**
 * Session status enum
 */
export declare const sessionStatusEnum: import('drizzle-orm/pg-core').PgEnum<
  ['active', 'archived', 'deleted']
>;
/**
 * Sessions table
 *
 * Stable logical conversation or execution container.
 */
export declare const sessions: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'sessions';
  schema: undefined;
  columns: {
    id: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'id';
        tableName: 'sessions';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    title: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'title';
        tableName: 'sessions';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    status: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'status';
        tableName: 'sessions';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'active' | 'archived' | 'deleted';
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['active', 'archived', 'deleted'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    createdAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'created_at';
        tableName: 'sessions';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    updatedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'updated_at';
        tableName: 'sessions';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    archivedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'archived_at';
        tableName: 'sessions';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    agentId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'agent_id';
        tableName: 'sessions';
        dataType: 'string';
        columnType: 'PgText';
        data: string | null;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
  };
  dialect: 'pg';
}>;
/**
 * Message role enum
 */
export declare const messageRoleEnum: import('drizzle-orm/pg-core').PgEnum<
  ['system', 'user', 'assistant', 'tool']
>;
/**
 * Session messages table
 *
 * Immutable transcript entries for sessions.
 * Uses append-only semantics with deterministic ordering via sequence number.
 */
export declare const sessionMessages: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'session_messages';
  schema: undefined;
  columns: {
    id: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'id';
        tableName: 'session_messages';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    sessionId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'session_id';
        tableName: 'session_messages';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    role: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'role';
        tableName: 'session_messages';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'system' | 'user' | 'assistant' | 'tool';
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['system', 'user', 'assistant', 'tool'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    content: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'content';
        tableName: 'session_messages';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    toolCallId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'tool_call_id';
        tableName: 'session_messages';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    sequence: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'sequence';
        tableName: 'session_messages';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    createdAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'created_at';
        tableName: 'session_messages';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    metadata: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'metadata';
        tableName: 'session_messages';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
  };
  dialect: 'pg';
}>;
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
export declare const runStatusEnum: import('drizzle-orm/pg-core').PgEnum<
  ['queued', 'running', 'succeeded', 'failed', 'cancelled']
>;
/**
 * Finish reason enum
 */
export declare const finishReasonEnum: import('drizzle-orm/pg-core').PgEnum<
  ['stop', 'length', 'tool_calls', 'content_filter', 'error']
>;
/**
 * Session runs table
 *
 * Tracks provider invocations associated with sessions.
 * Designed to support multiple concurrent runs across different sessions.
 */
export declare const sessionRuns: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'session_runs';
  schema: undefined;
  columns: {
    id: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'id';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    sessionId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'session_id';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    agentId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'agent_id';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    providerId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'provider_id';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    modelId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'model_id';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    status: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'status';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'failed' | 'queued' | 'running' | 'succeeded' | 'cancelled';
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    finishReason: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'finish_reason';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'length' | 'stop' | 'tool_calls' | 'content_filter' | 'error';
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['stop', 'length', 'tool_calls', 'content_filter', 'error'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    errorCode: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'error_code';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    errorMessage: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'error_message';
        tableName: 'session_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    promptTokens: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'prompt_tokens';
        tableName: 'session_runs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    completionTokens: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'completion_tokens';
        tableName: 'session_runs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    totalTokens: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'total_tokens';
        tableName: 'session_runs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    startedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'started_at';
        tableName: 'session_runs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    finishedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'finished_at';
        tableName: 'session_runs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    createdAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'created_at';
        tableName: 'session_runs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    metadata: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'metadata';
        tableName: 'session_runs';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
  };
  dialect: 'pg';
}>;
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
