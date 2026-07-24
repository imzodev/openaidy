import type {
  DatabaseClient,
  DatabaseClientConfig,
  DatabaseConnection,
} from '../client';
import type { SessionsRepository } from '../repositories/sessions';
import type { SessionMessagesRepository } from '../repositories/session-messages';
import type { MessageAttachmentsRepository } from '../repositories/message-attachments';
import type { SessionRunsRepository } from '../repositories/session-runs';
import type { JobsRepository } from '../repositories/jobs';
import type { JobRunsRepository } from '../repositories/job-runs';
import type {
  PairingRequestsRepository,
  DevicesRepository,
} from '../repositories/pairing';
import type { AccessTokensRepository } from '../repositories/access-tokens';
import type { TasksRepository } from '../repositories/tasks';
import type { SubtasksRepository } from '../repositories/subtasks';
import type { TaskAgentsRepository } from '../repositories/task-agents';
import type { AddonsRepository } from '../repositories/addons';
import type { MemoriesRepository } from '../repositories/memories';
import type { DeliverablesRepository } from '../repositories/deliverables';
import type { TaskSchedulesRepository } from '../repositories/task-schedules';
import type { TaskExecutionHistoryRepository } from '../repositories/task-execution-history';
import { z } from 'zod';

/**
 * Schema for session search results — single source of truth for:
 * - TypeScript type (via z.infer)
 * - Field documentation (via describe() calls)
 *
 * When you add/remove a field, update this schema only.
 */
export const sessionSearchResultSchema = z.object({
  id: z.string().describe('Unique session identifier'),
  title: z.string().describe('Session title'),
  status: z
    .enum(['active', 'archived', 'deleted'])
    .describe('Current session status'),
  createdAt: z.date().describe('When the session was created'),
  updatedAt: z.date().describe('When the session was last updated'),
  archivedAt: z
    .date()
    .nullable()
    .describe('When the session was archived (null if not archived)'),
  matchType: z
    .enum(['title', 'content'])
    .describe(
      'How the match was found: "title" = title field matched, "content" = message content matched',
    ),
  rank: z.number().describe('BM25 relevance rank (lower = better match)'),
  matchCount: z
    .number()
    .optional()
    .describe('For content matches: number of messages that matched the query'),
  snippet: z
    .string()
    .nullable()
    .describe(
      'Preview of matching content (truncated to 200 chars), null for title matches',
    ),
});

/**
 * TypeScript type derived from sessionSearchResultSchema.
 * Using z.infer ensures the type stays in sync with the schema.
 */
export type SessionSearchResult = z.infer<typeof sessionSearchResultSchema>;

/**
 * Field metadata for generating documentation.
 */
export interface SessionSearchFieldMeta {
  name: string;
  type: string;
  description: string;
}

/**
 * Generate field documentation for prompt injection.
 * Reads descriptions from the Zod schema.
 */
export function formatSessionSearchResultDocs(): string {
  const fields: SessionSearchFieldMeta[] = [
    {
      name: 'id',
      type: 'string',
      description: sessionSearchResultSchema.shape.id.description ?? '',
    },
    {
      name: 'title',
      type: 'string',
      description: sessionSearchResultSchema.shape.title.description ?? '',
    },
    {
      name: 'status',
      type: "'active' | 'archived' | 'deleted'",
      description: sessionSearchResultSchema.shape.status.description ?? '',
    },
    {
      name: 'createdAt',
      type: 'Date',
      description: sessionSearchResultSchema.shape.createdAt.description ?? '',
    },
    {
      name: 'updatedAt',
      type: 'Date',
      description: sessionSearchResultSchema.shape.updatedAt.description ?? '',
    },
    {
      name: 'archivedAt',
      type: 'Date | null',
      description: sessionSearchResultSchema.shape.archivedAt.description ?? '',
    },
    {
      name: 'matchType',
      type: "'title' | 'content'",
      description: sessionSearchResultSchema.shape.matchType.description ?? '',
    },
    {
      name: 'rank',
      type: 'number',
      description: sessionSearchResultSchema.shape.rank.description ?? '',
    },
    {
      name: 'matchCount',
      type: 'number | undefined',
      description: sessionSearchResultSchema.shape.matchCount.description ?? '',
    },
    {
      name: 'snippet',
      type: 'string | null',
      description: sessionSearchResultSchema.shape.snippet.description ?? '',
    },
  ];
  return fields
    .map((f) => `    - ${f.name} (${f.type}): ${f.description}`)
    .join('\n');
}

export type SessionsStore = Pick<
  SessionsRepository,
  | 'create'
  | 'findById'
  | 'list'
  | 'updateTitle'
  | 'updateAgentId'
  | 'updateStatus'
  | 'updateFavorite'
  | 'delete'
  | 'searchByTitle'
  | 'searchByContent'
  | 'backfillFtsIndex'
  | 'backfillMessagesFtsIndex'
>;

export type SessionMessagesStore = Pick<
  SessionMessagesRepository,
  | 'append'
  | 'listBySession'
  | 'listBySessionPaginated'
  | 'findById'
  | 'getLatest'
  | 'countBySession'
>;

export type MessageAttachmentsStore = Pick<
  MessageAttachmentsRepository,
  | 'create'
  | 'findById'
  | 'linkToMessage'
  | 'listBySession'
  | 'listByMessage'
  | 'delete'
>;

export type SessionRunsStore = Pick<
  SessionRunsRepository,
  | 'create'
  | 'findById'
  | 'listBySession'
  | 'markRunning'
  | 'markSucceeded'
  | 'markFailed'
  | 'markCancelled'
  | 'listRunning'
  | 'getLatest'
  | 'getActive'
  | 'countByStatus'
  | 'listUsageRows'
  | 'getSessionUsage'
  | 'getUsageBySession'
>;

export type JobsStore = Pick<
  JobsRepository,
  | 'claimNextDueJob'
  | 'create'
  | 'findById'
  | 'list'
  | 'update'
  | 'delete'
  | 'countByStatus'
  | 'listActive'
>;

export type JobRunsStore = Pick<
  JobRunsRepository,
  | 'create'
  | 'findById'
  | 'listByJob'
  | 'updateStatus'
  | 'getLatestByJob'
  | 'countByJobAndStatus'
  | 'listByStatus'
  | 'deleteByJob'
>;

export type PairingRequestsStore = Pick<
  PairingRequestsRepository,
  | 'create'
  | 'findById'
  | 'findByCode'
  | 'findByToken'
  | 'listAll'
  | 'listPending'
  | 'update'
>;

export type DevicesStore = Pick<
  DevicesRepository,
  'upsert' | 'findByNodeId' | 'findByToken' | 'listAll' | 'update'
>;

export type AccessTokensStore = Pick<
  AccessTokensRepository,
  'create' | 'findByHash' | 'findById' | 'list' | 'revoke' | 'touchLastUsed'
>;

export type TasksStore = TasksRepository;
export type SubtasksStore = SubtasksRepository;
export type TaskAgentsStore = TaskAgentsRepository;
/**
 * Public surface of TaskSchedulesRepository. The executor needs claim/find/update
 * but not the maintenance helpers (pause/resume/listByStatus), which are used by
 * the service layer (Phase 3) and the REST API (Phase 4). We re-export the full
 * class to keep the adapter wiring simple — the executor only uses a subset.
 */
export type TaskSchedulesStore = TaskSchedulesRepository;
export type TaskExecutionHistoryStore = TaskExecutionHistoryRepository;
export type AddonsStore = AddonsRepository;
export type MemoriesStore = MemoriesRepository;
export type DeliverablesStore = DeliverablesRepository;

export type DatabaseRepositories = {
  sessions: SessionsStore;
  sessionMessages: SessionMessagesStore;
  sessionRuns: SessionRunsStore;
  messageAttachments: MessageAttachmentsStore;
  jobs: JobsStore;
  jobRuns: JobRunsStore;
  pairingRequests: PairingRequestsStore;
  devices: DevicesStore;
  accessTokens: AccessTokensStore;
  tasks: TasksStore;
  subtasks: SubtasksStore;
  taskAgents: TaskAgentsStore;
  taskSchedules: TaskSchedulesStore;
  taskExecutionHistory: TaskExecutionHistoryStore;
  addons: AddonsStore;
  memories: MemoriesStore;
  deliverables: DeliverablesStore;
};

export type DatabaseAdapter = {
  kind: DatabaseClientConfig['kind'];
  client: DatabaseClient;
  connection: DatabaseConnection;
  repositories: DatabaseRepositories;
  close: () => Promise<void>;
};
