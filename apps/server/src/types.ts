import type {
  DatabaseAdapter,
  AccessTokensStore,
  DevicesStore,
  JobsStore,
  JobRunsStore,
  PairingRequestsStore,
  SessionsStore,
} from '@openaidy/db';
export type { CreateAgentInput } from '@openaidy/shared-types';
import type { ProviderServices } from './providers';
import type { SessionMessageService } from './sessions/service';
import type { AgentRegistry } from './agents';
import type { RunEventEmitter } from './dispatch';
import type { BootstrapAdminManager } from './bootstrap-admin';
import type { AppConfigService } from './config/service';
import type { WorkspaceService } from './workspace';
import type { McpClientService } from './mcp/client';
import type { SkillRegistry } from './skills';
import type { SchedulerService } from './scheduler';

export type SkillSource = 'preinstalled' | 'modified' | 'user-global' | 'agent';

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
};
