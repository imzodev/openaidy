import { describe, it, expect, vi } from 'vitest';
import { ok } from '@aidyagent/runtime';
import type { ModelRequest } from '@aidyagent/runtime';
import type { ReasoningEffort } from '@aidyagent/shared-types';
import { SessionMessageService } from './service';
import { AgentRegistry } from '../agents/registry';
import type {
  ProviderRegistryService,
  ProviderSelectionService,
  ModelInvocationService,
} from '../providers';

function setup(model: string, agentDefault?: ReasoningEffort) {
  const agents = new AgentRegistry();
  agents.replaceAll([
    {
      id: 'agent1',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Prompt',
      model,
      version: 1,
      ...(agentDefault ? { reasoningEffort: agentDefault } : {}),
    },
  ]);
  const seen: Array<ModelRequest['reasoningEffort']> = [];
  const service = new SessionMessageService({
    providers: {
      registry: {
        getDefault: vi.fn(),
        getEntry: vi.fn(),
      } as unknown as ProviderRegistryService,
      selection: {} as unknown as ProviderSelectionService,
      invocation: {
        invoke: vi.fn(),
        invokeStream: vi.fn(async function* (request: ModelRequest) {
          seen.push(request.reasoningEffort);
          yield ok({ type: 'stream.started', providerId: 'p', model: 'm' });
          yield ok({ type: 'stream.content_delta', delta: 'hi' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }),
      } as unknown as ModelInvocationService,
    },
    agents,
  });
  const send = async (reasoningEffort?: unknown) => {
    const session = (await service.createSession('chat')) as { id: string };
    await service.submitMessageStreaming({
      sessionId: session.id,
      role: 'user',
      content: 'hi',
      agentId: 'agent1',
      ...(reasoningEffort !== undefined
        ? { reasoningEffort: reasoningEffort as ReasoningEffort }
        : {}),
      onStreamEvent: () => {},
    });
  };
  return { seen, send };
}

describe('SessionMessageService — thinking effort', () => {
  it("uses the message's choice over the agent's default", async () => {
    const { seen, send } = setup('deepseek/deepseek-v4-flash', 'low');
    await send('max');
    expect(seen).toEqual(['max']);
  });

  it("falls back to the agent's default", async () => {
    const { seen, send } = setup('deepseek/deepseek-v4-flash', 'off');
    await send();
    expect(seen).toEqual(['off']);
  });

  it('clamps to what the model supports', async () => {
    const { seen, send } = setup('google/gemini-3.5-flash');
    await send('max');
    expect(seen).toEqual(['high']);
  });

  it('sends nothing for a model with no known control, or a bad value', async () => {
    const unknown = setup('openai/gpt-4o', 'high');
    await unknown.send('high');
    expect(unknown.seen).toEqual([undefined]);

    const bad = setup('deepseek/deepseek-v4-flash');
    await bad.send('turbo');
    expect(bad.seen).toEqual([undefined]);
  });
});
