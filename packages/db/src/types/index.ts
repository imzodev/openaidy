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
  PairingRequestsRepository,
  DevicesRepository,
} from '../repositories/pairing';
import type { ApiKeysRepository } from '../repositories/api-keys';
import type { TasksRepository } from '../repositories/tasks';
import type { SubtasksRepository } from '../repositories/subtasks';
import type { TaskAgentsRepository } from '../repositories/task-agents';

export type SessionsStore = Pick<
  SessionsRepository,
  'create' | 'findById' | 'list' | 'updateTitle' | 'updateStatus' | 'delete'
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

export type ApiKeysStore = Pick<
  ApiKeysRepository,
  'create' | 'findByHash' | 'findById' | 'list' | 'revoke' | 'touchLastUsed'
>;

export type TasksStore = TasksRepository;
export type SubtasksStore = SubtasksRepository;
export type TaskAgentsStore = TaskAgentsRepository;

export type DatabaseRepositories = {
  sessions: SessionsStore;
  sessionMessages: SessionMessagesStore;
  sessionRuns: SessionRunsStore;
  jobs: JobsStore;
  jobRuns: JobRunsStore;
  pairingRequests: PairingRequestsStore;
  devices: DevicesStore;
  apiKeys: ApiKeysStore;
  tasks: TasksStore;
  subtasks: SubtasksStore;
  taskAgents: TaskAgentsStore;
};

export type DatabaseAdapter = {
  kind: DatabaseClientConfig['kind'];
  client: DatabaseClient;
  connection: DatabaseConnection;
  repositories: DatabaseRepositories;
  close: () => Promise<void>;
};
