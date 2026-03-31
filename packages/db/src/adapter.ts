import {
  createDatabaseClient,
  type DatabaseClient,
  type DatabaseClientConfig,
  type DatabaseConnection,
} from './client';
import { createJobsRepository, type JobsRepository } from './repositories/jobs';
import { createJobRunsRepository, type JobRunsRepository } from './repositories/job-runs';
import { createDevicesRepository, createPairingRequestsRepository, type DevicesRepository, type PairingRequestsRepository } from './repositories/pairing';
import { createSessionsRepository, type SessionsRepository } from './repositories/sessions';
import { createSessionMessagesRepository, type SessionMessagesRepository } from './repositories/session-messages';
import { createSessionRunsRepository, type SessionRunsRepository } from './repositories/session-runs';

export type SessionsStore = Pick<SessionsRepository, 'create' | 'findById' | 'list' | 'updateTitle' | 'updateStatus' | 'delete'>;
export type SessionMessagesStore = Pick<SessionMessagesRepository, 'append' | 'listBySession' | 'listBySessionPaginated' | 'findById' | 'getLatest' | 'countBySession'>;
export type SessionRunsStore = Pick<SessionRunsRepository, 'create' | 'findById' | 'listBySession' | 'markRunning' | 'markSucceeded' | 'markFailed' | 'markCancelled' | 'getLatest' | 'getActive' | 'countByStatus'>;
export type JobsStore = Pick<JobsRepository, 'claimNextDueJob' | 'create' | 'findById' | 'list' | 'update' | 'delete' | 'countByStatus' | 'listActive'>;
export type JobRunsStore = Pick<JobRunsRepository, 'create' | 'findById' | 'listByJob' | 'updateStatus' | 'getLatestByJob' | 'countByJobAndStatus' | 'listByStatus' | 'deleteByJob'>;
export type PairingRequestsStore = Pick<PairingRequestsRepository, 'create' | 'findById' | 'findByCode' | 'findByToken' | 'listAll' | 'listPending' | 'update'>;
export type DevicesStore = Pick<DevicesRepository, 'upsert' | 'findByNodeId' | 'findByToken' | 'listAll' | 'update'>;

export type DatabaseRepositories = {
  sessions: SessionsStore;
  sessionMessages: SessionMessagesStore;
  sessionRuns: SessionRunsStore;
  jobs: JobsStore;
  jobRuns: JobRunsStore;
  pairingRequests: PairingRequestsStore;
  devices: DevicesStore;
};

export type DatabaseAdapter = {
  kind: DatabaseClientConfig['kind'];
  client: DatabaseClient;
  connection: DatabaseConnection;
  repositories: DatabaseRepositories;
  close: () => Promise<void>;
};

export function createDatabaseAdapter(config: DatabaseClientConfig): DatabaseAdapter {
  const connection = createDatabaseClient(config);
  const client = connection.db;

  const repositories: DatabaseRepositories = {
    sessions: createSessionsRepository(client),
    sessionMessages: createSessionMessagesRepository(client),
    sessionRuns: createSessionRunsRepository(client),
    jobs: createJobsRepository(client),
    jobRuns: createJobRunsRepository(client),
    pairingRequests: createPairingRequestsRepository(client),
    devices: createDevicesRepository(client),
  };

  return {
    kind: connection.kind,
    client,
    connection,
    repositories,
    close: connection.close,
  };
}
