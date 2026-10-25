import { describe, it, expect, vi } from 'vitest';
import { validateWorkflowGraph } from '@openaidy/workflow-templates';
import type { AgentRegistry } from '../../agents';
import { createLogger } from '../../lib/logger';
import type { ProviderServices } from '../../providers';
import { WorkflowDraftService } from './service';

const AGENTS = [
  {
    id: 'sales',
    name: 'Sales',
    description: 'Books meetings',
    mcpServers: [{ id: 'google-calendar' }],
    model: 'minimax/MiniMax-M2.7',
  },
];

const GOOD = {
  title: 'Citas por WhatsApp',
  nodes: [
    {
      key: 'slots',
      title: 'Buscar horarios',
      description: 'Find two free slots. End with OUTCOME: found or none.',
      agent: 'sales',
    },
    { key: 'ok', title: 'Aprobar', kind: 'approval_gate' },
    { key: 'reply', title: 'Responder', description: 'Reply to the client.' },
  ],
  edges: [
    { from: 'slots', to: 'ok', condition: 'found' },
    { from: 'ok', to: 'reply', condition: 'approved' },
  ],
  trigger: {
    kind: 'channel_message',
    channelId: 'wa',
    match: { type: 'starts_with', value: 'cita' },
  },
};

function setup(replies: string[]) {
  const invoke = vi.fn(async () => {
    const content = replies.shift() ?? '';
    return { ok: true as const, value: { content } };
  });
  const providers = {
    invocation: { invoke },
    registry: { getDefault: () => undefined },
  } as unknown as ProviderServices;
  const agents = {
    listAgents: () => AGENTS,
    getAgent: (id: string) => AGENTS.find((a) => a.id === id),
  } as unknown as AgentRegistry;
  const service = new WorkflowDraftService({
    providers,
    agents,
    getDefaultAgentId: () => 'sales',
    listChannels: () => [{ id: 'wa', type: 'whatsapp' }],
    taskService: {
      checkWorkflowGraph: (graph) =>
        validateWorkflowGraph(graph, { knownAgentIds: ['sales'] }),
    },
    logger: createLogger('test'),
  });
  return { service, invoke };
}

describe('WorkflowDraftService', () => {
  it('drafts a graph with its trigger from the model reply', async () => {
    const { service, invoke } = setup([
      'Here you go:\n```json\n' + JSON.stringify(GOOD) + '\n```',
    ]);
    const result = await service.draft('cuando escriban cita, ofrece horarios');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.title).toBe('Citas por WhatsApp');
    expect(result.data.graph.nodes.map((n) => n.key)).toEqual([
      'slots',
      'ok',
      'reply',
    ]);
    expect(result.data.graph.edges[1]).toMatchObject({
      edgeKind: 'conditional',
      conditionValue: 'approved',
    });
    expect(result.data.trigger).toEqual({
      kind: 'channel_message',
      channelId: 'wa',
      match: { type: 'starts_with', value: 'cita' },
      replyWithResult: true,
    });

    const [request, target] = invoke.mock.calls[0] as unknown as [
      { model: string; messages: Array<{ content: string }> },
      { providerId: string },
    ];
    expect(target.providerId).toBe('minimax');
    expect(request.model).toBe('MiniMax-M2.7');
    expect(request.messages[1]?.content).toContain(
      '- sales (Sales): Books meetings — integrations: google-calendar',
    );
    expect(request.messages[1]?.content).toContain('- wa (whatsapp)');
  });

  it('feeds problems back once and accepts the corrected graph', async () => {
    const broken = {
      ...GOOD,
      edges: [...GOOD.edges, { from: 'reply', to: 'slots' }],
    };
    const { service, invoke } = setup([
      JSON.stringify(broken),
      JSON.stringify(GOOD),
    ]);
    const result = await service.draft('book appointments');
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    const retry = (
      invoke.mock.calls[1] as unknown as [
        { messages: Array<{ role: string; content: string }> },
      ]
    )[0].messages;
    expect(retry.at(-1)?.content).toContain('cycle');
    expect(retry.at(-2)?.role).toBe('assistant');
  });

  it('gives up after the repair round', async () => {
    const { service } = setup(['not json', '{"nodes": []}']);
    const result = await service.draft('do things');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('draft.invalid');
      expect(result.error.message).toContain('no steps');
    }
  });

  it('drops a trigger on a channel that does not exist, with a warning', async () => {
    const { service } = setup([
      JSON.stringify({
        ...GOOD,
        trigger: { ...GOOD.trigger, channelId: 'telegram' },
      }),
    ]);
    const result = await service.draft('x');
    expect(result.ok && result.data.trigger).toBeNull();
    expect(result.ok && result.data.warnings.join(' ')).toContain(
      "channel isn't connected",
    );
  });

  it('accepts schedules and rejects invalid ones', async () => {
    const scheduled = setup([
      JSON.stringify({
        ...GOOD,
        trigger: {
          kind: 'schedule',
          schedule: { daily: { hour: 8, minute: 0 } },
        },
      }),
    ]);
    const ok = await scheduled.service.draft('every morning');
    expect(ok.ok && ok.data.trigger).toEqual({
      kind: 'schedule',
      schedule: { daily: { hour: 8, minute: 0 } },
    });

    const bad = setup([
      JSON.stringify({
        ...GOOD,
        trigger: {
          kind: 'schedule',
          schedule: { daily: { hour: 30, minute: 0 } },
        },
      }),
    ]);
    const dropped = await bad.service.draft('every morning');
    expect(dropped.ok && dropped.data.trigger).toBeNull();
  });

  it('refuses an empty description without calling the model', async () => {
    const { service, invoke } = setup([]);
    const result = await service.draft('   ');
    expect(!result.ok && result.error.code).toBe('draft.empty');
    expect(invoke).not.toHaveBeenCalled();
  });
});
