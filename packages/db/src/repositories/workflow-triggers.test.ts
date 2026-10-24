/**
 * SQLite-backed tests for WorkflowTriggersRepository and the run columns
 * triggers add (input, reply target), including the upgrade path for a
 * database created before they existed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from '../node-sqlite';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { TasksRepository } from './tasks';
import { WorkflowRunsRepository } from './workflow-runs';
import { WorkflowTriggersRepository } from './workflow-triggers';

describe('WorkflowTriggersRepository (sqlite)', () => {
  const dbPath = join(tmpdir(), `openaidy-workflow-triggers-${Date.now()}.db`);
  let conn: DatabaseConnection;
  let tasksRepo: TasksRepository;
  let triggersRepo: WorkflowTriggersRepository;

  async function setup() {
    conn = await createDatabaseClient({ kind: 'sqlite', sqlitePath: dbPath });
    tasksRepo = new TasksRepository(conn.db);
    triggersRepo = new WorkflowTriggersRepository(conn.db);
    return tasksRepo.create({ title: 'Workflow', description: 'desc' });
  }

  afterEach(async () => {
    if (conn) await conn.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('creates, lists, updates and deletes triggers', async () => {
    const task = await setup();
    const hook = await triggersRepo.create({
      taskId: task.id,
      kind: 'webhook',
      name: 'Form',
      config: '{}',
      secretHash: 'abc',
    });
    const message = await triggersRepo.create({
      taskId: task.id,
      kind: 'channel_message',
      name: 'Quote',
      config: JSON.stringify({ channelId: 'wa' }),
    });
    expect(hook.enabled).toBe(true);
    expect(hook.lastFiredAt).toBeNull();

    expect((await triggersRepo.listByTask(task.id)).map((t) => t.id)).toEqual([
      hook.id,
      message.id,
    ]);
    expect((await triggersRepo.list('webhook')).map((t) => t.id)).toEqual([
      hook.id,
    ]);

    await triggersRepo.update(message.id, { enabled: false });
    expect(await triggersRepo.listEnabled('channel_message')).toEqual([]);

    await triggersRepo.markFired(hook.id);
    expect((await triggersRepo.findById(hook.id))?.lastFiredAt).toBeInstanceOf(
      Date,
    );

    await triggersRepo.delete(hook.id);
    expect(await triggersRepo.findById(hook.id)).toBeNull();
  });

  it('deletes a workflow’s triggers with the workflow', async () => {
    const task = await setup();
    await triggersRepo.create({
      taskId: task.id,
      kind: 'webhook',
      name: 'Form',
      config: '{}',
    });
    await tasksRepo.delete(task.id);
    expect(await triggersRepo.list()).toEqual([]);
  });

  it('stores run input and reply target', async () => {
    const task = await setup();
    const runs = new WorkflowRunsRepository(conn.db);
    const run = await runs.create({
      taskId: task.id,
      trigger: 'channel',
      input: 'quote for 3 chairs',
      replyTarget: JSON.stringify({ channelId: 'wa', target: '123@s' }),
    });
    expect(run.trigger).toBe('channel');
    expect(run.input).toBe('quote for 3 chairs');
    expect(JSON.parse(run.replyTarget!)).toEqual({
      channelId: 'wa',
      target: '123@s',
    });
  });

  it('adds the run columns to a database created before them', async () => {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'running',
        session_id TEXT,
        history_id TEXT,
        error TEXT,
        summary TEXT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT
      );
    `);
    legacy.close();

    const task = await setup();
    const run = await new WorkflowRunsRepository(conn.db).create({
      taskId: task.id,
      trigger: 'webhook',
      input: '{"name":"Ada"}',
    });
    expect(run.input).toBe('{"name":"Ada"}');
  });
});
