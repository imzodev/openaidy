/**
 * Integration test: verify that taskExecutionHistoryRepo.create actually
 * inserts a row into the SQLite DB. This is the missing piece in the
 * recurring-tasks audit trail (the schedule.executionCount updates but
 * no history row is ever written).
 *
 * Run with: pnpm --filter @openaidy/db test -- src/integration/history-create.test.ts
 *
 * Connects to the same SQLite DB the dev server uses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseAdapter } from '../adapter';

describe('taskExecutionHistoryRepo.create (sqlite integration)', () => {
  const DB_PATH = '../../apps/server/data/openaidy.db';
  let adapter: Awaited<ReturnType<typeof createDatabaseAdapter>>;

  beforeAll(async () => {
    adapter = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath: DB_PATH,
    });
  });

  afterAll(async () => {
    if (adapter) await adapter.close();
  });

  it('inserts a row into task_execution_history for an existing task + schedule', async () => {
    const repo = adapter.repositories.taskExecutionHistory;
    const row = await repo.create({
      taskId: '3v96Kifo6ZQE_PbGmlybD',
      scheduleId: 'sFnZ35HScgSjsDnGh-dMt',
      taskTitle: 'TEST Di una palabra en ingles',
      taskDescription: 'TEST',
    });
    expect(row.id).toBeTruthy();
    expect(row.status).toBe('planned');

    // Read it back.
    const found = await repo.findById(row.id);
    expect(found).toBeTruthy();
    expect(found?.taskTitle).toBe('TEST Di una palabra en ingles');
  });
});
