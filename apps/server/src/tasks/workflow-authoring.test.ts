/**
 * Workflow authoring tests: the rules for building and editing a graph
 * (shared validation, whole-graph writes, the edit lock during runs and
 * resetting stale results), against a real SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDatabaseAdapter,
  type DatabaseAdapter,
  type Task,
} from '@openaidy/db';
import { DEFAULT_EXECUTION_CONFIG } from '@openaidy/config';
import type { AgentRegistry } from '../agents';
import { TaskService, type TaskServiceOptions } from './service';
import { FakeSessions, deferred } from './testing/fake-sessions';
import { createWorkflowCreateTool } from '../tools/workflows/create';
import { createWorkflowGetTool } from '../tools/workflows/get';
import { createWorkflowSetGraphTool } from '../tools/workflows/set-graph';

const CTX = { agentId: 'concierge', sessionId: 'chat' };

const AGENTS = [
  { id: 'writer', name: 'Writer' },
  { id: 'editor', name: 'Editor' },
];

const agents = {
  listAgents: () => AGENTS,
  getAgent: (id: string) => AGENTS.find((a) => a.id === id),
} as unknown as AgentRegistry;

describe('workflow authoring', { timeout: 20000 }, () => {
  let dir: string;
  let db: DatabaseAdapter;
  let sessions: FakeSessions;
  let service: TaskService;
  let task: Task;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-workflow-authoring-'));
    db = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath: join(dir, 'openaidy.db'),
    });
    sessions = new FakeSessions(db);
    service = new TaskService({
      tasksRepo: db.repositories.tasks,
      subtasksRepo: db.repositories.subtasks,
      taskAgentsRepo: db.repositories.taskAgents,
      workflowRunsRepo: db.repositories.workflowRuns,
      agents,
      sessionService: sessions as unknown as NonNullable<
        TaskServiceOptions['sessionService']
      >,
      getExecutionConfig: () => DEFAULT_EXECUTION_CONFIG,
    });
    task = await db.repositories.tasks.create({
      title: 'Workflow',
      description: 'A workflow',
      planningEnabled: true,
    });
  });

  afterEach(async () => {
    await service.whenIdle();
    service.destroy();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const rows = () => db.repositories.subtasks.listByTask(task.id);
  const byTitle = async () =>
    Object.fromEntries((await rows()).map((s) => [s.title, s]));

  const draftReview = {
    nodes: [
      {
        key: 'draft',
        title: 'Draft',
        description: 'Write the post',
        agentId: 'Writer',
      },
      { key: 'review', title: 'Review', kind: 'approval_gate' },
      { key: 'publish', title: 'Publish', description: 'Post it' },
      { key: 'revise', title: 'Revise', description: 'Rework it' },
    ],
    edges: [
      { from: 'draft', to: 'review' },
      {
        from: 'review',
        to: 'publish',
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'approved',
      },
      {
        from: 'review',
        to: 'revise',
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'rejected',
      },
    ],
  };

  describe('setWorkflowGraph', () => {
    it('writes the whole graph and resolves agents by name', async () => {
      const result = await service.setWorkflowGraph(task.id, draftReview);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.nodes.map((n) => n.key)).toEqual([
        'draft',
        'review',
        'publish',
        'revise',
      ]);
      expect(result.data.edgeCount).toBe(3);

      const nodes = await byTitle();
      expect(nodes['Draft']?.assignedAgentId).toBe('writer');
      expect(nodes['Review']?.subtaskKind).toBe('approval_gate');
      const edges = await db.repositories.subtasks.listEdgesByTaskFull(task.id);
      expect(
        edges.find((e) => e.subtaskId === nodes['Publish']!.id),
      ).toMatchObject({
        dependsOnSubtaskId: nodes['Review']!.id,
        edgeKind: 'conditional',
        conditionValue: 'approved',
      });
      const check = await service.checkWorkflow(task.id);
      expect(check.ok && check.data.ok).toBe(true);
    });

    it('writes nothing when the graph has errors', async () => {
      await service.setWorkflowGraph(task.id, draftReview);
      const before = (await rows()).map((s) => s.id).sort();

      const result = await service.setWorkflowGraph(task.id, {
        nodes: [{ key: 'a', description: 'x', agentId: 'ghost' }],
        edges: [{ from: 'a', to: 'tests' }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('workflow.invalid_graph');
      expect(result.error.message).toContain('unknown node "tests"');
      expect(result.error.message).toContain('agent "ghost"');
      expect((await rows()).map((s) => s.id).sort()).toEqual(before);
    });

    it('only validates on a dry run', async () => {
      const result = await service.setWorkflowGraph(task.id, draftReview, {
        dryRun: true,
      });
      expect(result.ok).toBe(true);
      expect(await rows()).toHaveLength(0);
    });

    it('replaces the old graph, and keeps it if the write fails', async () => {
      await service.setWorkflowGraph(task.id, draftReview);
      const original = (await rows()).map((s) => s.id).sort();

      const addEdge = vi
        .spyOn(db.repositories.subtasks, 'addEdge')
        .mockRejectedValueOnce(new Error('disk full'));
      const failed = await service.setWorkflowGraph(task.id, {
        nodes: [
          { key: 'a', description: 'one' },
          { key: 'b', description: 'two' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error.message).toContain('disk full');
      expect((await rows()).map((s) => s.id).sort()).toEqual(original);
      addEdge.mockRestore();

      const replaced = await service.setWorkflowGraph(task.id, {
        nodes: [{ key: 'only', description: 'just this' }],
        edges: [],
      });
      expect(replaced.ok).toBe(true);
      expect((await rows()).map((s) => s.title)).toEqual(['just this']);
    });
  });

  describe('applyWorkflowTemplate with clearExisting', () => {
    it('replaces the graph and leaves it alone when the template fails', async () => {
      await service.setWorkflowGraph(task.id, draftReview);
      const original = (await rows()).map((s) => s.id).sort();

      const missing = await service.applyWorkflowTemplate(
        task.id,
        'software-development',
        {},
        { clearExisting: true },
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok)
        expect(missing.error.code).toBe('template.missing_input');
      expect((await rows()).map((s) => s.id).sort()).toEqual(original);

      const applied = await service.applyWorkflowTemplate(
        task.id,
        'software-development',
        { repo: 'acme/app', branch: 'main' },
        { clearExisting: true },
      );
      expect(applied.ok).toBe(true);
      const ids = (await rows()).map((s) => s.id);
      expect(ids.some((id) => original.includes(id))).toBe(false);
      expect(ids).toHaveLength(applied.ok ? applied.data.nodeCount : -1);
    });
  });

  describe('single edits', () => {
    it('rejects a duplicate edge and an invalid regex condition', async () => {
      const a = await service.createSubtask({
        taskId: task.id,
        title: 'A',
        description: 'a',
      });
      const b = await service.createSubtask({
        taskId: task.id,
        title: 'B',
        description: 'b',
      });
      if (!a.ok || !b.ok) throw new Error('setup');
      const first = await service.createSubtaskEdge(task.id, {
        subtaskId: b.data.id,
        dependsOnSubtaskId: a.data.id,
      });
      expect(first.ok).toBe(true);

      const again = await service.createSubtaskEdge(task.id, {
        subtaskId: b.data.id,
        dependsOnSubtaskId: a.data.id,
      });
      expect(again.ok).toBe(false);
      if (!again.ok) {
        expect(again.error.code).toBe('workflow.invalid_graph');
        expect(again.error.message).toContain('more than once');
      }

      if (!first.ok) return;
      const regex = await service.updateSubtaskEdge(first.data.id, {
        edgeKind: 'conditional',
        condition: { operator: 'matches_regex', value: '(' },
      });
      expect(regex.ok).toBe(false);
      if (!regex.ok)
        expect(regex.error.message).toContain('regular expression');
    });

    it('rejects a loop on an approval step and drops the loop when a step becomes one', async () => {
      const gate = await service.createSubtask({
        taskId: task.id,
        title: 'Gate',
        description: 'ok?',
        subtaskKind: 'approval_gate',
      });
      if (!gate.ok) throw new Error('setup');
      const looped = await service.updateSubtask(gate.data.id, {
        loop: {
          maxIterations: 3,
          conditionOperator: 'equals',
          conditionValue: 'done',
        },
      });
      expect(looped.ok).toBe(false);

      const step = await service.createSubtask({
        taskId: task.id,
        title: 'Step',
        description: 'do',
        loop: {
          maxIterations: 3,
          conditionOperator: 'equals',
          conditionValue: 'done',
        },
      });
      if (!step.ok) throw new Error('setup');
      const converted = await service.updateSubtask(step.data.id, {
        subtaskKind: 'approval_gate',
      });
      expect(converted.ok).toBe(true);
      if (converted.ok) expect(converted.data.loopMaxIterations).toBeNull();
    });

    it('does not block an edit because of an older, unrelated problem', async () => {
      const a = await db.repositories.subtasks.create({
        taskId: task.id,
        title: 'A',
        description: 'a',
        assignedAgentId: 'deleted-agent',
      });
      const b = await db.repositories.subtasks.create({
        taskId: task.id,
        title: 'B',
        description: 'b',
      });
      const edit = await service.createSubtaskEdge(task.id, {
        subtaskId: b.id,
        dependsOnSubtaskId: a.id,
      });
      expect(edit.ok).toBe(true);
    });
  });

  describe('editing around runs', () => {
    it('refuses graph edits while a run is going, but allows layout changes', async () => {
      await service.setWorkflowGraph(task.id, {
        nodes: [{ key: 'a', title: 'A', description: 'a' }],
        edges: [],
      });
      const gate = deferred<string>();
      sessions.reply = () => gate.promise;
      expect((await service.startRun(task.id)).ok).toBe(true);

      const [a] = await rows();
      const edit = await service.updateSubtask(a!.id, { description: 'b' });
      expect(edit.ok).toBe(false);
      if (!edit.ok) expect(edit.error.code).toBe('workflow.locked');
      const add = await service.createSubtask({
        taskId: task.id,
        title: 'B',
        description: 'b',
      });
      expect(add.ok).toBe(false);
      const replace = await service.setWorkflowGraph(task.id, {
        nodes: [],
        edges: [],
      });
      expect(replace.ok).toBe(false);

      const layout = await service.saveWorkflowLayout(task.id, {
        [a!.id]: { x: 5, y: 6 },
      });
      expect(layout.ok).toBe(true);

      gate.resolve('Done.');
      await service.whenIdle();
      const after = await service.updateSubtask(a!.id, { description: 'b' });
      expect(after.ok).toBe(true);
    });

    it('resets an edited completed step and what ran after it, but keeps failed steps retryable', async () => {
      await service.setWorkflowGraph(task.id, {
        nodes: [
          { key: 'a', title: 'A', description: 'STEP-A' },
          { key: 'b', title: 'B', description: 'STEP-B' },
          { key: 'c', title: 'C', description: 'STEP-C' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
        ],
      });
      sessions.reply = (turn) =>
        turn.content.includes('STEP-C') ? { fail: 'boom' } : 'Done.';
      await service.startRun(task.id);
      await service.whenIdle();
      let nodes = await byTitle();
      expect(nodes['A']?.status).toBe('completed');
      expect(nodes['B']?.status).toBe('completed');
      expect(nodes['C']?.status).toBe('failed');

      // A failed step keeps its status after an edit, so Retry still shows.
      await service.updateSubtask(nodes['C']!.id, { description: 'c, again' });
      expect((await byTitle())['C']?.status).toBe('failed');

      await service.updateSubtask(nodes['B']!.id, { description: 'b, better' });
      nodes = await byTitle();
      expect(nodes['A']?.status).toBe('completed');
      expect(nodes['B']?.status).toBe('pending');
      expect(nodes['C']?.status).toBe('pending');
    });

    it('refuses to run an empty workflow or one with errors', async () => {
      const empty = await service.startRun(task.id);
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.error.message).toContain('no steps');

      await db.repositories.subtasks.create({
        taskId: task.id,
        title: 'A',
        description: 'a',
        assignedAgentId: 'ghost',
      });
      const invalid = await service.startRun(task.id);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error.code).toBe('workflow.invalid_graph');
        expect(invalid.error.message).toContain('"ghost"');
      }
    });
  });

  describe('agent tools', () => {
    it('builds a runnable 5-step workflow in one workflow_create call', async () => {
      const tool = createWorkflowCreateTool(() => service);
      const result = await tool.execute(
        {
          description: 'Weekly newsletter',
          nodes: [
            { key: 'research', description: 'Collect news', agent: 'writer' },
            { key: 'draft', description: 'Write the issue', agent: 'Writer' },
            { key: 'review', title: 'Review', kind: 'approval_gate' },
            { key: 'send', description: 'Send it', agent: 'editor' },
            { key: 'revise', description: 'Apply the feedback' },
          ],
          edges: [
            { from: 'research', to: 'draft' },
            { from: 'draft', to: 'review' },
            { from: 'review', to: 'send', condition: 'approved' },
            { from: 'review', to: 'revise', condition: 'rejected' },
          ],
        },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const id = /ID: (\S+)/.exec(result.content)![1]!;
      expect(result.content).toContain('research → ');

      const check = await service.checkWorkflow(id);
      expect(check.ok && check.data).toMatchObject({
        ok: true,
        errors: [],
        warnings: [],
      });
      const steps = await db.repositories.subtasks.listByTask(id);
      expect(steps).toHaveLength(5);
      expect(steps.filter((s) => s.assignedAgentId === 'writer')).toHaveLength(
        2,
      );
    });

    it('creates nothing when the graph has problems, and says what they are', async () => {
      const before = await db.repositories.tasks.list();
      const tool = createWorkflowCreateTool(() => service);
      const result = await tool.execute(
        {
          description: 'Broken',
          nodes: [
            { key: 'code', description: 'Write code' },
            {
              key: 'gate',
              kind: 'approval_gate',
              loop: {
                maxIterations: 2,
                conditionOperator: 'equals',
                conditionValue: 'x',
              },
            },
          ],
          edges: [{ from: 'code', to: 'tests' }],
        },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(
        'Edge 1 (code → tests): unknown node "tests".',
      );
      expect(result.error).toContain("approval steps can't repeat");
      expect(await db.repositories.tasks.list()).toHaveLength(before.length);
    });

    it('round-trips workflow_get output through workflow_set_graph', async () => {
      await service.setWorkflowGraph(task.id, draftReview);
      const get = createWorkflowGetTool(() => service);
      const read = await get.execute({ workflowId: task.id }, CTX);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const payload = JSON.parse(read.content) as {
        nodes: Array<Record<string, unknown>>;
        edges: Array<Record<string, unknown>>;
        problems: { errors: string[]; warnings: string[] };
      };
      expect(payload.problems).toEqual({ errors: [], warnings: [] });

      const set = createWorkflowSetGraphTool(() => service);
      const dry = await set.execute(
        {
          workflowId: task.id,
          nodes: payload.nodes,
          edges: payload.edges,
          dryRun: true,
        },
        CTX,
      );
      expect(dry.ok).toBe(true);
      if (dry.ok) expect(dry.content).toContain('4 nodes, 3 edges');

      const bad = await set.execute(
        {
          workflowId: task.id,
          nodes: payload.nodes,
          edges: [
            ...payload.edges,
            { from: payload.nodes[0]!['id'], to: 'nope' },
          ],
        },
        CTX,
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toContain('unknown node "nope"');
    });
  });
});
