import { createDatabaseClient, type DatabaseClientConfig } from './client';
import type { DatabaseAdapter, DatabaseRepositories } from './types';
import { createJobsRepository } from './repositories/jobs';
import { createJobRunsRepository } from './repositories/job-runs';
import {
  createDevicesRepository,
  createPairingRequestsRepository,
} from './repositories/pairing';
import { createSessionsRepository } from './repositories/sessions';
import { createSessionMessagesRepository } from './repositories/session-messages';
import { createSessionRunsRepository } from './repositories/session-runs';
import { createApiKeysRepository } from './repositories/api-keys';
import { createTasksRepository } from './repositories/tasks';
import { createSubtasksRepository } from './repositories/subtasks';
import { createTaskAgentsRepository } from './repositories/task-agents';

export type { DatabaseAdapter, DatabaseRepositories } from './types';

export function createDatabaseAdapter(
  config: DatabaseClientConfig,
): DatabaseAdapter {
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
    apiKeys: createApiKeysRepository(client),
    tasks: createTasksRepository(client),
    subtasks: createSubtasksRepository(client),
    taskAgents: createTaskAgentsRepository(client),
  };

  return {
    kind: connection.kind,
    client,
    connection,
    repositories,
    close: connection.close,
  };
}
