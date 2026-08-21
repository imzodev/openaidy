/**
 * SQLite-backed regression test for the planningEnabled round-trip.
 *
 * Without this test, the bug reported in the workflow feature could come
 * back: TasksRepository.create manually coerced planningEnabled to 1/0
 * (number) for SQLite, but TasksRepository.update spread the raw boolean
 * — which the node:sqlite driver rejects with
 * "Provided value cannot be bound to SQLite parameter 1". The Postgres
 * integration suite (tasks.test.ts) was the only coverage and it never
 * ran on SQLite, so the bug shipped undetected.
 *
 * This test runs on every environment via createDatabaseClient('sqlite')
 * and pins both directions of the round-trip:
 *
 *   create({planningEnabled: true})  -> row.planningEnabled === 1
 *   update(id, {planningEnabled: true})  -> row.planningEnabled === 1
 *   update(id, {planningEnabled: false}) -> row.planningEnabled === 0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { TasksRepository } from './tasks';

describe('TasksRepository — planningEnabled round-trip (sqlite)', () => {
  const dbPath = join(tmpdir(), `openaidy-planning-test-${Date.now()}.db`);
  let conn: DatabaseConnection;
  let repo: TasksRepository;

  beforeEach(async () => {
    conn = await createDatabaseClient({ kind: 'sqlite', sqlitePath: dbPath });
    repo = new TasksRepository(conn.db);
  });

  afterEach(async () => {
    if (conn) await conn.close();
    try {
      rmSync(dbPath, { force: true });
    } catch {
      // best-effort cleanup; tmpdir is wiped by the OS anyway
    }
  });

  it('create({planningEnabled: true}) persists 1 in SQLite', async () => {
    const task = await repo.create({
      title: 'workflow create',
      description: 'd',
      planningEnabled: true,
    });

    const fresh = await repo.findById(task.id);
    expect(fresh?.planningEnabled).toBe(1);
    expect(fresh?.planningStatus).toBe('pending');
  });

  it('create({}) persists 0 in SQLite', async () => {
    const task = await repo.create({ title: 'plain task', description: 'd' });

    const fresh = await repo.findById(task.id);
    expect(fresh?.planningEnabled).toBe(0);
    expect(fresh?.planningStatus).toBeNull();
  });

  it('update({planningEnabled: true}) persists 1 (no binding error)', async () => {
    const task = await repo.create({ title: 'plain', description: 'd' });
    expect(task.planningEnabled).toBe(0);

    const updated = await repo.update(task.id, { planningEnabled: true });
    expect(updated?.planningEnabled).toBe(1);

    const fresh = await repo.findById(task.id);
    expect(fresh?.planningEnabled).toBe(1);
  });

  it('update({planningEnabled: false}) persists 0', async () => {
    const task = await repo.create({
      title: 'workflow',
      description: 'd',
      planningEnabled: true,
    });
    expect(task.planningEnabled).toBe(1);

    const updated = await repo.update(task.id, { planningEnabled: false });
    expect(updated?.planningEnabled).toBe(0);
  });

  it('omitting planningEnabled from update leaves the column untouched', async () => {
    const task = await repo.create({
      title: 'workflow',
      description: 'd',
      planningEnabled: true,
    });
    expect(task.planningEnabled).toBe(1);

    const updated = await repo.update(task.id, { title: 'renamed' });
    expect(updated?.planningEnabled).toBe(1);
    expect(updated?.title).toBe('renamed');
  });
});
