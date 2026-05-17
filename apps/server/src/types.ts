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
} from '@openaidy/db';
export type { CreateAgentInput } from '@openaidy/shared-types';
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

export type ChannelRoutesOptions = {
  channelRegistry: ChannelRegistry;
  authMiddleware: AuthMiddleware;
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
};

export type KanbanBoard = { [K in TaskStatus]: Task[] };

export type TaskServiceOptions = {
  tasksRepo: import('@openaidy/db').TasksRepository;
  subtasksRepo: import('@openaidy/db').SubtasksRepository;
  taskAgentsRepo: import('@openaidy/db').TaskAgentsRepository;
  agents?: AgentRegistry;
  sessionService?: SessionMessageService;
  planningService?: import('./planning').PlanningService;
  runEvents?: RunEventEmitter;
};

export type SkillSource = 'preinstalled' | 'modified' | 'user-global' | 'agent';

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
};
