/**
 * Every built-in template applied to a real SQLite workflow: the graph is
 * valid, steps get the chosen agent, and the suggested trigger comes back
 * filled in (and can be set up by the agent tools).
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
import type { TemplateInput } from '@openaidy/shared-types';
import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';
import type { AgentRegistry } from '../agents';
import type { ChannelRegistry } from '../channels';
import { createLogger } from '../lib/logger';
import { TaskService, type TaskServiceOptions } from './service';
import { FakeSessions } from './testing/fake-sessions';
import { WorkflowTriggerService } from './triggers/service';
import type { TaskScheduleService } from './schedule-service';
import { createWorkflowApplyTemplateTool } from '../tools/workflows/apply-template';
import { createWorkflowTemplateListTool } from '../tools/workflows/template-list-tool';
import { createChannelSendTool } from '../tools/channels/send';

const CTX = { agentId: 'concierge', sessionId: 'chat' };
const AGENTS = [{ id: 'sales', name: 'Sales' }];
const agents = {
  listAgents: () => AGENTS,
  getAgent: (id: string) => AGENTS.find((a) => a.id === id),
} as unknown as AgentRegistry;

/** A value for every input, the way the creation form would fill it. */
function fill(inputs: TemplateInput[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of inputs) {
    if (input.type === 'agent') values[input.key] = 'sales';
    else if (input.type === 'channel') values[input.key] = 'wa';
    else if (input.default !== undefined) values[input.key] = input.default;
    else values[input.key] = `${input.key} value`;
  }
  return values;
}

describe('built-in workflow templates', { timeout: 20000 }, () => {
  let dir: string;
  let db: DatabaseAdapter;
  let service: TaskService;
  let triggers: WorkflowTriggerService;
  let task: Task;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-templates-'));
    db = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath: join(dir, 'openaidy.db'),
    });
    service = new TaskService({
      tasksRepo: db.repositories.tasks,
      subtasksRepo: db.repositories.subtasks,
      taskAgentsRepo: db.repositories.taskAgents,
      workflowRunsRepo: db.repositories.workflowRuns,
      agents,
      sessionService: new FakeSessions(db) as unknown as NonNullable<
        TaskServiceOptions['sessionService']
      >,
      getExecutionConfig: () => DEFAULT_EXECUTION_CONFIG,
    });
    triggers = new WorkflowTriggerService({
      triggersRepo: db.repositories.workflowTriggers,
      taskService: service,
      listChannelIds: () => ['wa'],
      sendToChannel: async () => true,
      logger: createLogger('test'),
    });
    task = await db.repositories.tasks.create({
      title: 'Workflow',
      description: 'From a template',
      planningEnabled: true,
    });
  });

  afterEach(async () => {
    await service.whenIdle();
    triggers.destroy();
    service.destroy();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  for (const template of WORKFLOW_TEMPLATES) {
    it(`applies "${template.id}" as a runnable workflow`, async () => {
      const result = await service.applyWorkflowTemplate(
        task.id,
        template.id,
        fill(template.inputs),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.nodeCount).toBe(template.nodes.length);

      const check = await service.checkWorkflow(task.id);
      expect(check.ok && check.data.errors).toEqual([]);

      const steps = await db.repositories.subtasks.listByTask(task.id);
      for (const step of steps) {
        expect(step.description).not.toMatch(/\{\{\w+\}\}/);
        expect(step.title).not.toMatch(/\{\{\w+\}\}/);
      }
      const usesAgentInput = template.nodes.some(
        (n) => n.agent === '{{agent}}',
      );
      if (usesAgentInput) {
        expect(
          steps
            .filter((s) => s.subtaskKind === 'agent')
            .every((s) => s.assignedAgentId === 'sales'),
        ).toBe(true);
      }

      if (template.trigger?.kind === 'channel_message') {
        expect(result.data.trigger).toMatchObject({
          kind: 'channel_message',
          channelId: 'wa',
        });
        if (result.data.trigger?.kind === 'channel_message') {
          expect(result.data.trigger.match.value ?? '').not.toContain('{{');
        }
      } else if (template.trigger) {
        expect(result.data.trigger).toEqual(template.trigger);
      }
    });
  }

  it('falls back to the default agent for an unknown agent', async () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === 'daily-sales-summary',
    )!;
    await service.applyWorkflowTemplate(task.id, template.id, {
      ...fill(template.inputs),
      agent: 'ghost',
    });
    const steps = await db.repositories.subtasks.listByTask(task.id);
    expect(steps.every((s) => s.assignedAgentId === null)).toBe(true);
  });

  it('sets up the suggested trigger or schedule from the tool', async () => {
    const createSchedule = vi.fn(async () => ({ ok: true as const, data: {} }));
    const tool = createWorkflowApplyTemplateTool(() => service, {
      getTriggerService: () => triggers,
      getScheduleService: () =>
        ({ createSchedule }) as unknown as TaskScheduleService,
    });

    const lead = WORKFLOW_TEMPLATES.find(
      (t) => t.id === 'whatsapp-lead-booking',
    )!;
    const applied = await tool.execute(
      {
        workflowId: task.id,
        templateId: lead.id,
        templateInputs: fill(lead.inputs),
        setupTrigger: true,
      },
      CTX,
    );
    expect(applied.ok && applied.content).toContain(
      'Starts on messages that start with "cita" on channel wa.',
    );
    const [trigger] = await triggers.listAll();
    expect(trigger?.channel).toMatchObject({
      channelId: 'wa',
      match: { type: 'starts_with', value: 'cita' },
      ackText: '👋',
    });

    const other = await db.repositories.tasks.create({
      title: 'Sales',
      description: 'x',
      planningEnabled: true,
    });
    const summary = WORKFLOW_TEMPLATES.find(
      (t) => t.id === 'daily-sales-summary',
    )!;
    const scheduled = await tool.execute(
      {
        workflowId: other.id,
        templateId: summary.id,
        templateInputs: fill(summary.inputs),
        setupTrigger: true,
      },
      CTX,
    );
    expect(scheduled.ok && scheduled.content).toContain('Scheduled:');
    expect(createSchedule).toHaveBeenCalledWith(other.id, {
      schedule: { daily: { hour: 8, minute: 0 } },
    });

    const suggestedOnly = await tool.execute(
      {
        workflowId: other.id,
        templateId: summary.id,
        templateInputs: fill(summary.inputs),
        clearExisting: true,
      },
      CTX,
    );
    expect(suggestedOnly.ok && suggestedOnly.content).toContain(
      'pass setupTrigger=true',
    );
  });

  it('lists templates with their inputs for agents', async () => {
    const result = await createWorkflowTemplateListTool().execute({}, CTX);
    expect(result.ok && result.content).toContain('- whatsapp-lead-booking:');
    expect(result.ok && result.content).toContain(
      'language (select one of Spanish/English/Portuguese; default "Spanish")',
    );
  });
});

describe('channel_send', () => {
  const channel = {
    id: 'wa',
    getStatus: () => 'connected',
    send: vi.fn(async () => true),
  };
  const registry = {
    get: (id: string) => (id === 'wa' ? channel : undefined),
    getAll: () => [channel],
  } as unknown as ChannelRegistry;

  it('sends on the channel', async () => {
    const tool = createChannelSendTool(() => registry);
    const result = await tool.execute(
      { channelId: 'wa', to: '+52 155 1234 5678', text: 'Hola' },
      CTX,
    );
    expect(result.ok).toBe(true);
    expect(channel.send).toHaveBeenCalledWith('+52 155 1234 5678', 'Hola');
  });

  it('explains unknown channels and failed sends', async () => {
    const tool = createChannelSendTool(() => registry);
    const unknown = await tool.execute(
      { channelId: 'sms', to: '1', text: 'x' },
      CTX,
    );
    expect(!unknown.ok && unknown.error).toContain('Available: wa');
    channel.send.mockResolvedValueOnce(false);
    const failed = await tool.execute(
      { channelId: 'wa', to: '1', text: 'x' },
      CTX,
    );
    expect(!failed.ok && failed.error).toContain("it's connected");
  });
});
