import type {
  DatabaseClient,
  DatabaseClientConfig,
  DatabaseConnection,
} from '../client';
import type { SessionsRepository } from '../repositories/sessions';
import type { SessionMessagesRepository } from '../repositories/session-messages';
import type { SessionRunsRepository } from '../repositories/session-runs';
import type { JobsRepository } from '../repositories/jobs';
import type { JobRunsRepository } from '../repositories/job-runs';
import type {
  DevicesRepository,
  PairingRequestsRepository,
} from '../repositories/pairing';
import type { AccessTokensRepository } from '../repositories/access-tokens';
import type { TasksRepository } from '../repositories/tasks';
import type { SubtasksRepository } from '../repositories/subtasks';
import type { TaskAgentsRepository } from '../repositories/task-agents';
import type { AddonsRepository } from '../repositories/addons';
import type { DeliverablesRepository } from '../repositories/deliverables';

export type SessionsStore = Pick<
  SessionsRepository,
  | 'create'
  | 'findById'
  | 'list'
  | 'updateTitle'
  | 'updateAgentId'
  | 'updateStatus'
  | 'delete'
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

export type SessionRunsStore = Pick<
  SessionRunsRepository,
  | 'create'
  | 'findById'
  | 'listBySession'
  | 'markRunning'
  | 'markSucceeded'
  | 'markFailed'
  | 'markCancelled'
  | 'getLatest'
  | 'getActive'
  | 'countByStatus'
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
export type AddonsStore = AddonsRepository;
export type DeliverablesStore = DeliverablesRepository;

export type DatabaseRepositories = {
  sessions: SessionsStore;
  sessionMessages: SessionMessagesStore;
  sessionRuns: SessionRunsStore;
  jobs: JobsStore;
  jobRuns: JobRunsStore;
  pairingRequests: PairingRequestsStore;
  devices: DevicesStore;
  accessTokens: AccessTokensStore;
  tasks: TasksStore;
  subtasks: SubtasksStore;
  taskAgents: TaskAgentsStore;
  addons: AddonsStore;
  deliverables: DeliverablesStore;
};

export type DatabaseAdapter = {
  kind: DatabaseClientConfig['kind'];
  client: DatabaseClient;
  connection: DatabaseConnection;
  repositories: DatabaseRepositories;
  close: () => Promise<void>;
};
