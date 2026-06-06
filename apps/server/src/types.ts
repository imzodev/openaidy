import type {
  DatabaseAdapter,
  AccessTokensStore,
  DevicesStore,
  JobsStore,
  JobRunsStore,
  PairingRequestsStore,
  SessionsStore,
  Task,
  TaskAgent,
  TaskStatus,
  TaskPriority,
  Subtask,
  AgentRole,
  TasksRepository,
  TaskSchedulesRepository,
  TaskExecutionHistoryRepository,
} from '@openaidy/db';
export type { CreateAgentInput } from '@openaidy/shared-types';
import type { MessageRole, FinishReason } from '@openaidy/shared-types';
export type { MessageRole, FinishReason };

/**
 * In-memory session record (used by the fallback in-memory store)
 */
export type SessionRecord = {
  id: string;
  title: string;
  type?: import('@openaidy/shared-types').SessionType;
  createdAt: string;
};

/**
 * In-memory session message record
 */
export type SessionMessageRecord = {
  id: string;
  sessionId: string;
  runId?: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  reasoningContent?: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * In-memory session run record
 */
export type SessionRunRecord = {
  id: string;
  sessionId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  status: import('@openaidy/shared-types').RunStatus;
  finishReason?: FinishReason;
  errorCode?: string;
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

import type { ProviderServices } from './providers';
import type { SessionMessageService } from './sessions/service';
import type { AgentRegistry } from './agents';
import type { RunEventEmitter } from './dispatch';
import type { BootstrapAdminManager } from './bootstrap-admin';
import type { AppConfigService } from './config/service';
import type { WorkspaceService } from './workspace';
import type { AgentPersonalityService } from './agents/personality-service';
import type { McpClientService } from './mcp/client';
import type { SkillRegistry } from './skills';
import type { SchedulerService } from './scheduler';
import type { ChannelRegistry } from './channels/index.js';
import type { AuthMiddleware } from './websocket/middleware/auth.js';
import type { TaskScheduleService } from './tasks/schedule-service';
import type { TaskScheduleExecutor } from './tasks/execution/task-schedule-executor';

export type ChannelRoutesOptions = {
  channelRegistry: ChannelRegistry;
  authMiddleware: AuthMiddleware;
};

export type TaskScheduleServiceDeps = {
  tasksRepo: TasksRepository;
  taskSchedulesRepo: TaskSchedulesRepository;
  taskExecutionHistoryRepo: TaskExecutionHistoryRepository;
  taskScheduleExecutor: TaskScheduleExecutor;
};

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type CreateTaskInput = {
  title: string;
  description: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
  agents?: Array<{ agentId: string; role?: AgentRole }>;
  schedule?: import('@openaidy/shared-types').CreateTaskScheduleInput;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
  sessionId?: string | null;
};

export type CreateSubtaskInput = {
  taskId: string;
  parentSubtaskId?: string;
  title: string;
  description: string;
  orderIndex?: number;
  assignedAgentId?: string;
};

export type TaskWithDetails = Task & {
  agents: TaskAgent[];
  subtasks: Subtask[];
  progress: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
  };
  schedule?: import('@openaidy/shared-types').TaskScheduleDto;
};

export type KanbanBoard = { [K in TaskStatus]: Task[] };

export type TaskServiceOptions = {
  tasksRepo: import('@openaidy/db').TasksRepository;
  subtasksRepo: import('@openaidy/db').SubtasksRepository;
  taskAgentsRepo: import('@openaidy/db').TaskAgentsRepository;
  deliverablesRepo?: import('@openaidy/db').DeliverablesRepository;
  agents?: AgentRegistry;
  sessionService?: SessionMessageService;
  planningService?: import('./planning').PlanningService;
  runEvents?: RunEventEmitter;
  workspaceBaseDir?: string;
};

export type SkillSource = 'preinstalled' | 'modified' | 'user-global' | 'agent';

/**
 * Input for appending a message to a session (shared by SessionMessageService and DispatchService)
 */
export type AppendMessageInput = {
  sessionId: string;
  runId?: string;
  role: 'user' | 'system' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  reasoningContent?: string;
  metadata?: Record<string, unknown>;
};

export type ToolMeta = {
  name: string;
  category: string;
  description: string;
};

export type WorkspacePermissionsInfo = {
  read: boolean;
  write: boolean;
  delete: boolean;
  list: boolean;
};

export type EnrichedSkillInfo = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  agentId?: string;
};

export type AppServices = {
  config: AppConfigService;
  providers: ProviderServices;
  sessions: SessionMessageService;
  agents: AgentRegistry;
  runEvents: RunEventEmitter;
  bootstrapAdmin: BootstrapAdminManager | undefined;
  dbAdapter: DatabaseAdapter | undefined;
  scheduler: SchedulerService | undefined;
  jobsRepo: JobsStore | undefined;
  jobRunsRepo: JobRunsStore | undefined;
  sessionsRepo: SessionsStore | undefined;
  pairingRequestsRepo: PairingRequestsStore | undefined;
  devicesRepo: DevicesStore | undefined;
  accessTokensRepo: AccessTokensStore | undefined;
  workspace: WorkspaceService;
  mcpService: McpClientService;
  skills: SkillRegistry;
  personality: AgentPersonalityService;
  channels: ChannelRegistry;
  taskSchedules: TaskScheduleService | undefined;
};
