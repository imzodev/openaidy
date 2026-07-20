import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionMessageService } from './service';
import { BuiltinToolRegistry } from '../tools/registry';
import { AgentRegistry } from '../agents/registry';
import type { BuiltinTool } from '@openaidy/runtime';
import { ok } from '@openaidy/runtime';
import type {
  ProviderRegistryService,
  ProviderSelectionService,
  ModelInvocationService,
} from '../providers';

/**
 * Unit tests for the builtin tool execution guard in SessionMessageService.
 *
 * The guard pattern (from service.ts) is:
 *   const enabledTools = agents.getAgent(agentId)?.tools ?? [];
 *   const builtinTool = enabledTools.includes(tc.name)
 *     ? builtinTools.get(tc.name)
 *     : undefined;
 *
 * These tests verify the guard logic directly using real registry and agent instances,
 * without spinning up the full session service.
 */

function makeTool(
  name: string,
  executeFn?: () => Promise<{ ok: true; content: string }>,
): BuiltinTool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute:
      executeFn ??
      vi.fn().mockResolvedValue({ ok: true, content: `result of ${name}` }),
  };
}

function makeAgent(tools: string[] | undefined) {
  return {
    id: 'agent1',
    name: 'Test Agent',
    enabled: true,
    systemPrompt: 'Prompt',
    model: 'openai/gpt-4',
    version: 1 as const,
    tools,
  };
}

/** Mirrors the guard in service.ts */
function resolveBuiltinTool(
  toolName: string,
  agentId: string,
  agents: AgentRegistry,
  builtinTools: BuiltinToolRegistry,
): BuiltinTool | undefined {
  const enabledTools = agents.getAgent(agentId)?.tools ?? [];
  return enabledTools.includes(toolName)
    ? builtinTools.get(toolName)
    : undefined;
}

describe('SessionMessageService — builtin tool execution guard', () => {
  let builtinTools: BuiltinToolRegistry;
  let agents: AgentRegistry;

  beforeEach(() => {
    builtinTools = new BuiltinToolRegistry();
    builtinTools.register(makeTool('workspace_read'));
    builtinTools.register(makeTool('workspace_list'));
    builtinTools.register(makeTool('workspace_write'));

    agents = new AgentRegistry();
  });

  it('resolves a tool that is registered and enabled for the agent', () => {
    agents.replaceAll([makeAgent(['workspace_read', 'workspace_list'])]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('workspace_read');
  });

  it('returns undefined for a tool that is registered but NOT in the agent tools list', () => {
    agents.replaceAll([makeAgent(['workspace_read'])]);

    const tool = resolveBuiltinTool(
      'workspace_write',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('returns undefined when agent has no tools configured (undefined)', () => {
    agents.replaceAll([makeAgent(undefined)]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('returns undefined when agent has an empty tools array', () => {
    agents.replaceAll([makeAgent([])]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('returns undefined when the agent does not exist', () => {
    agents.replaceAll([]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'ghost',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('reflects in-memory tool update immediately — disabled tool becomes inaccessible', () => {
    agents.replaceAll([makeAgent(['workspace_read', 'workspace_write'])]);

    expect(
      resolveBuiltinTool('workspace_write', 'agent1', agents, builtinTools),
    ).toBeDefined();

    agents.updateAgentTools('agent1', ['workspace_read']); // disable workspace_write

    expect(
      resolveBuiltinTool('workspace_write', 'agent1', agents, builtinTools),
    ).toBeUndefined();
    expect(
      resolveBuiltinTool('workspace_read', 'agent1', agents, builtinTools),
    ).toBeDefined();
  });

  it('reflects in-memory tool update immediately — enabled tool becomes accessible', () => {
    agents.replaceAll([makeAgent([])]);

    expect(
      resolveBuiltinTool('workspace_list', 'agent1', agents, builtinTools),
    ).toBeUndefined();

    agents.updateAgentTools('agent1', ['workspace_list']);

    expect(
      resolveBuiltinTool('workspace_list', 'agent1', agents, builtinTools),
    ).toBeDefined();
  });
});

// ============================================================================
// generateTitle
// ============================================================================

function makeServiceWithInvokeResult(content: string | null) {
  const invoke =
    content === null
      ? vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'provider.error', message: 'fail' },
        })
      : vi.fn().mockResolvedValue({ ok: true, value: { content } });

  return {
    service: new SessionMessageService({
      providers: {
        registry: {
          getDefault: vi.fn(),
          getEntry: vi.fn(),
        } as unknown as ProviderRegistryService,
        selection: {} as unknown as ProviderSelectionService,
        invocation: {
          invoke,
          invokeStream: vi.fn(),
        } as unknown as ModelInvocationService,
      },
    }),
    invoke,
  };
}

describe('SessionMessageService.generateTitle', () => {
  it('extracts title from a clean JSON response', async () => {
    const { service } = makeServiceWithInvokeResult(
      '{"title":"Fix login bug"}',
    );
    const title = await service.generateTitle(
      'Fix the login bug',
      'openai',
      'gpt-4o',
    );
    expect(title).toBe('Fix login bug');
  });

  it('extracts title when reasoning text precedes the JSON (no think tags)', async () => {
    const { service } = makeServiceWithInvokeResult(
      'The user wants me to generate a short conversation title\n{"title":"Fix login bug"}',
    );
    const title = await service.generateTitle(
      'Fix the login bug',
      'deepseek',
      'deepseek-reasoner',
    );
    expect(title).toBe('Fix login bug');
  });

  it('extracts title when <think> tags wrap the reasoning before the JSON', async () => {
    const { service } = makeServiceWithInvokeResult(
      '<think>The user wants a title (3-6 words)\nLet me think...</think>\n{"title":"Schedule team meeting"}',
    );
    const title = await service.generateTitle(
      'Schedule a team meeting',
      'deepseek',
      'deepseek-reasoner',
    );
    expect(title).toBe('Schedule team meeting');
  });

  it('returns null when provider call fails', async () => {
    const { service } = makeServiceWithInvokeResult(null);
    const title = await service.generateTitle('hello', 'openai', 'gpt-4o');
    expect(title).toBeNull();
  });

  it('returns null when response contains no JSON with a title field', async () => {
    const { service } = makeServiceWithInvokeResult(
      'The user wants me to generate a short title',
    );
    const title = await service.generateTitle(
      'hello',
      'deepseek',
      'deepseek-reasoner',
    );
    expect(title).toBeNull();
  });

  it('returns null when provider throws', async () => {
    const service = new SessionMessageService({
      providers: {
        registry: {
          getDefault: vi.fn(),
          getEntry: vi.fn(),
        } as unknown as ProviderRegistryService,
        selection: {} as unknown as ProviderSelectionService,
        invocation: {
          invoke: vi.fn().mockRejectedValue(new Error('network error')),
          invokeStream: vi.fn(),
        } as unknown as ModelInvocationService,
      },
    });
    const title = await service.generateTitle('hello', 'openai', 'gpt-4o');
    expect(title).toBeNull();
  });

  it('passes maxTokens: 300 to the provider', async () => {
    const { service, invoke } = makeServiceWithInvokeResult(
      '{"title":"Short title"}',
    );
    await service.generateTitle('hello', 'openai', 'gpt-4o');
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 300 }),
      expect.anything(),
    );
  });
});

// ============================================================================
// updateSessionTitle
// ============================================================================

const makeMinimalProviders = () => ({
  registry: {
    getDefault: vi.fn(),
    getEntry: vi.fn(),
  } as unknown as ProviderRegistryService,
  selection: {} as unknown as ProviderSelectionService,
  invocation: {
    invoke: vi.fn(),
    invokeStream: vi.fn(),
  } as unknown as ModelInvocationService,
});

describe('SessionMessageService.updateSessionTitle', () => {
  it('updates title in the in-memory store', async () => {
    const service = new SessionMessageService({
      providers: makeMinimalProviders(),
    });

    const session = await service.createSession('New Session');
    const sessionId = (session as { id: string }).id;

    const updated = await service.updateSessionTitle(
      sessionId,
      'Renamed Title',
    );
    expect((updated as { title: string } | null)?.title).toBe('Renamed Title');

    const fetched = await service.getSession(sessionId);
    expect((fetched as { title: string } | null)?.title).toBe('Renamed Title');
  });

  it('returns null for a non-existent session id', async () => {
    const service = new SessionMessageService({
      providers: makeMinimalProviders(),
    });

    const result = await service.updateSessionTitle(
      'does-not-exist',
      'Any title',
    );
    expect(result).toBeNull();
  });
});

// ============================================================================
// Agentic tool-call loop — round-exhaustion handling
//
// Regression coverage for the "agent silently stops mid-task, user must say
// 'continue'" bug: when the loop exhausted MAX_TOOL_ROUNDS right after the last
// round's tool calls, it exited before the model could turn those results into
// an answer and persisted an EMPTY assistant message with finish_reason
// `tool_calls`. (Diagnosed from run Ozpbnm8Y… — exactly 10 tool-call rounds
// then a blank final message.)
// ============================================================================

/** Build a streaming-capable service wired to a scripted invokeStream mock. */
function makeStreamingService(opts: {
  maxToolRounds: number;
  invokeStream: (request: {
    tools?: unknown[];
  }) => AsyncGenerator<unknown, void, unknown>;
}) {
  const agents = new AgentRegistry();
  agents.replaceAll([makeAgent(['echo'])]);
  const builtinTools = new BuiltinToolRegistry();
  builtinTools.register(makeTool('echo'));

  const invokeStream = vi.fn(opts.invokeStream);

  const service = new SessionMessageService({
    providers: {
      registry: {
        getDefault: vi.fn(),
        getEntry: vi.fn(),
      } as unknown as ProviderRegistryService,
      selection: {} as unknown as ProviderSelectionService,
      invocation: {
        invoke: vi.fn(),
        invokeStream,
      } as unknown as ModelInvocationService,
    },
    agents,
    builtinTools,
    maxToolRounds: opts.maxToolRounds,
  });

  return { service, invokeStream };
}

async function submit(
  service: SessionMessageService,
  sessionId: string,
  content = 'do the thing',
) {
  return service.submitMessageStreaming({
    sessionId,
    role: 'user',
    content,
    agentId: 'agent1',
    providerId: 'mock',
    modelId: 'mock',
    onStreamEvent: () => {},
  });
}

describe('SessionMessageService — agentic loop round exhaustion', () => {
  it('forces a final text answer (tools withheld on the last round) instead of ending empty', async () => {
    // Model asks for a tool on every round where tools are offered. Without the
    // fix, all rounds would be tool calls and the run would end with a blank
    // assistant message. With the fix, the final round is invoked WITHOUT tools,
    // forcing a text response.
    const { service, invokeStream } = makeStreamingService({
      maxToolRounds: 3,
      invokeStream: async function* (request) {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        if (request.tools && request.tools.length > 0) {
          yield ok({
            type: 'stream.tool_call',
            toolCall: {
              id: `tc_${Math.random()}`,
              name: 'echo',
              arguments: {},
            },
          });
          yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
        } else {
          yield ok({ type: 'stream.content_delta', delta: 'FINAL_ANSWER' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('Loop');
    const result = await submit(service, (session as { id: string }).id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Non-empty, real answer — not a blank bubble.
    expect(result.assistantMessage.content).toBe('FINAL_ANSWER');
    // Exactly maxToolRounds invocations; the last one withheld tools.
    expect(invokeStream).toHaveBeenCalledTimes(3);
    const lastReq = invokeStream.mock.calls[2]![0] as { tools?: unknown[] };
    expect(lastReq.tools ?? []).toHaveLength(0);
    const firstReq = invokeStream.mock.calls[0]![0] as { tools?: unknown[] };
    expect((firstReq.tools ?? []).length).toBeGreaterThan(0);
  });

  it('substitutes a fallback message when the model reports finish_reason tool_calls but emits no tool call and no content', async () => {
    // Reproduces the exact seq-33 degenerate turn: finish_reason `tool_calls`
    // with zero parsed tool calls and empty content. Must never persist a blank
    // assistant message.
    const { service } = makeStreamingService({
      maxToolRounds: 5,
      invokeStream: async function* () {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
      },
    });

    const session = await service.createSession('Empty turn');
    const result = await submit(service, (session as { id: string }).id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistantMessage.content.trim().length).toBeGreaterThan(0);
    expect(result.assistantMessage.content.toLowerCase()).toContain('continue');
  });
});
