/**
 * Integration test: verify that taskExecutionHistoryRepo.create actually
 * inserts a row into the DB. This is the missing piece in the
 * recurring-tasks audit trail (the schedule.executionCount updates but
 * no history row is ever written).
 *
 * Hermetic: spins up a fresh in-memory SQLite DB and seeds the parent
 * task + schedule the FK constraints require. The tasks/task-schedules
 * repositories use Postgres-style Drizzle inserts that don't run on
 * SQLite (the same mismatch task-execution-history.ts documents), so the
 * parent rows are seeded via raw SQL — the same approach the repo under
 * test uses for its own insert.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { TaskExecutionHistoryRepository } from '../repositories/task-execution-history';

type Database = DatabaseConnection['db'];

describe('taskExecutionHistoryRepo.create (sqlite integration)', () => {
  let db: Database;
  let repo: TaskExecutionHistoryRepository;
  const taskId = 'task_test_history';
  const scheduleId = 'schedule_test_history';

  beforeEach(async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: ':memory:',
    });
    db = conn.db;
    repo = new TaskExecutionHistoryRepository(db);

    // Seed the parent rows the FK constraints require.
    const now = new Date().toISOString();
    await db.run(
      sql`INSERT INTO tasks (id, title, description, created_at, updated_at)
          VALUES (${taskId}, ${'TEST task'}, ${'TEST'}, ${now}, ${now})`,
    );
    await db.run(
      sql`INSERT INTO task_schedules (id, task_id, next_run_at, created_at, updated_at)
          VALUES (${scheduleId}, ${taskId}, ${now}, ${now}, ${now})`,
    );
  });

  it('inserts a row into task_execution_history for an existing task + schedule', async () => {
    const row = await repo.create({
      taskId,
      scheduleId,
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
