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
import type {
  SessionsStore,
  SessionMessagesStore,
  SessionRunsStore,
} from '@openaidy/db';

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
// Ephemeral (private chat) sessions
// ============================================================================

/** Throws if any method on the mock is called — proves a code path never
 * reaches a DB-backed repo for an ephemeral session. */
function makeThrowingRepo(label: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return (..._args: unknown[]) => {
          throw new Error(
            `${label}.${String(prop)} should not be called for an ephemeral session`,
          );
        };
      },
    },
  );
}

describe('SessionMessageService — ephemeral (private chat) sessions', () => {
  it('marks the created session ephemeral and excludes it from listSessions', async () => {
    const service = new SessionMessageService({
      providers: makeMinimalProviders(),
    });

    const normal = await service.createSession('Normal chat');
    const priv = await service.createSession('Private chat', undefined, {
      ephemeral: true,
    });

    expect((priv as { ephemeral?: boolean }).ephemeral).toBe(true);
    expect((normal as { ephemeral?: boolean }).ephemeral).toBeUndefined();

    const listed = await service.listSessions();
    const ids = listed.map((s) => (s as { id: string }).id);
    expect(ids).toContain((normal as { id: string }).id);
    expect(ids).not.toContain((priv as { id: string }).id);
  });

  it('still supports get/update/delete for an ephemeral session via the in-memory store', async () => {
    const service = new SessionMessageService({
      providers: makeMinimalProviders(),
    });

    const priv = await service.createSession('Private chat', undefined, {
      ephemeral: true,
    });
    const id = (priv as { id: string }).id;

    expect(await service.getSession(id)).not.toBeNull();

    const renamed = await service.updateSessionTitle(id, 'Renamed private');
    expect((renamed as { title: string } | null)?.title).toBe(
      'Renamed private',
    );

    expect(await service.deleteSession(id)).toBe(true);
    expect(await service.getSession(id)).toBeNull();
  });

  it('cleanupExpiredEphemeralSessions sweeps only expired ephemeral sessions', async () => {
    const service = new SessionMessageService({
      providers: makeMinimalProviders(),
    });

    const normal = await service.createSession('Normal chat');
    const priv = await service.createSession('Private chat', undefined, {
      ephemeral: true,
    });
    const normalId = (normal as { id: string }).id;
    const privId = (priv as { id: string }).id;

    // Negative maxAge: any elapsed time (including ~0ms) counts as expired.
    // (The in-memory store is a module-level singleton shared across tests in
    // this file, so other ephemeral sessions may also be swept here — assert
    // on this test's own session rather than an exact count.)
    const removed = service.cleanupExpiredEphemeralSessions(-1);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await service.getSession(privId)).toBeNull();
    // A non-ephemeral session is never swept, regardless of age.
    expect(await service.getSession(normalId)).not.toBeNull();
  });

  it('hides ephemeral-unsafe tools (e.g. memory_save) from the model in a private chat, but keeps them for a normal session', async () => {
    const agents = new AgentRegistry();
    agents.replaceAll([makeAgent(['memory_save', 'echo'])]);
    const builtinTools = new BuiltinToolRegistry();
    builtinTools.register(makeTool('memory_save'));
    builtinTools.register(makeTool('echo'));

    const seenToolNames: string[][] = [];
    const service = new SessionMessageService({
      providers: {
        registry: {
          getDefault: vi.fn(),
          getEntry: vi.fn(),
        } as unknown as ProviderRegistryService,
        selection: {} as unknown as ProviderSelectionService,
        invocation: {
          invoke: vi.fn(),
          invokeStream: vi.fn(async function* (request: {
            tools?: Array<{ name: string }>;
          }) {
            seenToolNames.push((request.tools ?? []).map((t) => t.name));
            yield ok({
              type: 'stream.started',
              providerId: 'mock',
              model: 'mock',
            });
            yield ok({ type: 'stream.content_delta', delta: 'hi' });
            yield ok({ type: 'stream.finished', finishReason: 'stop' });
          }),
        } as unknown as ModelInvocationService,
      },
      agents,
      builtinTools,
    });

    const normal = await service.createSession('Normal chat');
    await submit(service, (normal as { id: string }).id);

    const priv = await service.createSession('Private chat', undefined, {
      ephemeral: true,
    });
    await submit(service, (priv as { id: string }).id);

    expect(seenToolNames).toHaveLength(2);
    expect(seenToolNames[0]).toEqual(
      expect.arrayContaining(['memory_save', 'echo']),
    );
    expect(seenToolNames[1]).toEqual(['echo']);
    expect(seenToolNames[1]).not.toContain('memory_save');
  });

  it('never touches configured DB repos for an ephemeral session end-to-end', async () => {
    const agents = new AgentRegistry();
    agents.replaceAll([makeAgent([])]);
    const builtinTools = new BuiltinToolRegistry();

    const service = new SessionMessageService({
      providers: {
        registry: {
          getDefault: vi.fn(),
          getEntry: vi.fn(),
        } as unknown as ProviderRegistryService,
        selection: {} as unknown as ProviderSelectionService,
        invocation: {
          invoke: vi.fn(),
          invokeStream: vi.fn(async function* () {
            yield ok({
              type: 'stream.started',
              providerId: 'mock',
              model: 'mock',
            });
            yield ok({ type: 'stream.content_delta', delta: 'hi' });
            yield ok({ type: 'stream.finished', finishReason: 'stop' });
          }),
        } as unknown as ModelInvocationService,
      },
      agents,
      builtinTools,
      repositories: {
        sessions: makeThrowingRepo('sessionsRepo') as unknown as SessionsStore,
        messages: makeThrowingRepo(
          'messagesRepo',
        ) as unknown as SessionMessagesStore,
        runs: makeThrowingRepo('runsRepo') as unknown as SessionRunsStore,
      },
    });

    const priv = await service.createSession('Private chat', undefined, {
      ephemeral: true,
    });
    const sessionId = (priv as { id: string }).id;

    const result = await submit(service, sessionId);

    expect(result.ok).toBe(true);
    // Per-session reads/writes (append/createRun/markRun*/updateSessionAgentId)
    // all resolved without hitting the throwing repo mocks above — the only
    // way this assertion is reachable at all.
    const fetched = await service.getSession(sessionId);
    expect((fetched as { ephemeral?: boolean } | null)?.ephemeral).toBe(true);
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
  maxToolOutputChars?: number;
  maxContextTokens?: number;
  historyToolResultsKept?: number;
  /** Custom executor for the 'echo' tool (e.g. to return an oversized result). */
  echoExecute?: () => Promise<{ ok: true; content: string }>;
  invokeStream: (request: {
    tools?: unknown[];
  }) => AsyncGenerator<unknown, void, unknown>;
}) {
  const agents = new AgentRegistry();
  agents.replaceAll([makeAgent(['echo'])]);
  const builtinTools = new BuiltinToolRegistry();
  builtinTools.register(makeTool('echo', opts.echoExecute));

  const invokeStream = vi.fn(opts.invokeStream);

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

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
    logger: logger as unknown as import('fastify').FastifyBaseLogger,
    agents,
    builtinTools,
    maxToolRounds: opts.maxToolRounds,
    ...(opts.maxToolOutputChars !== undefined && {
      maxToolOutputChars: opts.maxToolOutputChars,
    }),
    ...(opts.maxContextTokens !== undefined && {
      maxContextTokens: opts.maxContextTokens,
    }),
    ...(opts.historyToolResultsKept !== undefined && {
      historyToolResultsKept: opts.historyToolResultsKept,
    }),
  });

  return { service, invokeStream, logger };
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

// ============================================================================
// Agentic tool-call loop — tool-output context cap (issue #436)
// ============================================================================

describe('SessionMessageService — tool-output context cap', () => {
  it('truncates an oversized tool result in the model context but persists it in full', async () => {
    const HUGE = 'X'.repeat(500);
    let finalRoundMessages: Array<{ role: string; content: string }> = [];

    const { service } = makeStreamingService({
      maxToolRounds: 2,
      maxToolOutputChars: 100,
      echoExecute: async () => ({ ok: true as const, content: HUGE }),
      invokeStream: async function* (request) {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        if (request.tools && request.tools.length > 0) {
          yield ok({
            type: 'stream.tool_call',
            toolCall: { id: 'tc_1', name: 'echo', arguments: {} },
          });
          yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
        } else {
          // Final round: capture what the model actually sees, then answer.
          finalRoundMessages =
            (request as { messages?: Array<{ role: string; content: string }> })
              .messages ?? [];
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('Cap');
    const sessionId = (session as { id: string }).id;
    const result = await submit(service, sessionId);
    expect(result.ok).toBe(true);

    // The context copy the model received is truncated with a notice.
    const contextToolMsg = finalRoundMessages.find((m) => m.role === 'tool');
    expect(contextToolMsg).toBeDefined();
    expect(contextToolMsg!.content).toContain('truncated for context');
    expect(contextToolMsg!.content).not.toContain(HUGE);
    // Cap (100) + the notice — well under the raw 500 chars.
    expect(contextToolMsg!.content.length).toBeLessThan(HUGE.length);

    // The persisted transcript keeps the full, untruncated result.
    const persisted = await service.listMessages(sessionId);
    const persistedToolMsg = (
      persisted as Array<{ role: string; content: string }>
    ).find((m) => m.role === 'tool');
    expect(persistedToolMsg).toBeDefined();
    expect(persistedToolMsg!.content).toBe(HUGE);
  });

  it('leaves a tool result under the cap untouched', async () => {
    const SMALL = 'ok';
    let finalRoundMessages: Array<{ role: string; content: string }> = [];

    const { service } = makeStreamingService({
      maxToolRounds: 2,
      maxToolOutputChars: 100,
      echoExecute: async () => ({ ok: true as const, content: SMALL }),
      invokeStream: async function* (request) {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        if (request.tools && request.tools.length > 0) {
          yield ok({
            type: 'stream.tool_call',
            toolCall: { id: 'tc_1', name: 'echo', arguments: {} },
          });
          yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
        } else {
          finalRoundMessages =
            (request as { messages?: Array<{ role: string; content: string }> })
              .messages ?? [];
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('No cap');
    await submit(service, (session as { id: string }).id);

    const toolMsg = finalRoundMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe(SMALL);
    expect(toolMsg?.content).not.toContain('truncated');
  });
});

// ============================================================================
// Agentic tool-call loop — context-window compaction (issue #437)
// ============================================================================

describe('SessionMessageService — context-window compaction', () => {
  it('elides older tool-result bodies in the model context when over the token budget', async () => {
    const BIG = 'Y'.repeat(400); // > the 200-char elide threshold
    let finalRoundMessages: Array<{ role: string; content: string }> = [];

    const { service } = makeStreamingService({
      maxToolRounds: 3,
      // Tiny budget so accumulated tool output must be compacted…
      maxContextTokens: 20,
      // …but the per-result cap is high, so #436 truncation is NOT what fires.
      maxToolOutputChars: 100_000,
      echoExecute: async () => ({ ok: true as const, content: BIG }),
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
          finalRoundMessages =
            (request as { messages?: Array<{ role: string; content: string }> })
              .messages ?? [];
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('Compact');
    const sessionId = (session as { id: string }).id;
    const result = await submit(service, sessionId);
    expect(result.ok).toBe(true);

    // At least one older tool result was collapsed to the elision notice…
    const toolMsgs = finalRoundMessages.filter((m) => m.role === 'tool');
    const elided = toolMsgs.filter((m) =>
      m.content.includes('elided to fit context'),
    );
    expect(elided.length).toBeGreaterThan(0);
    // …and elided by #437 (compaction), not #436 (per-result truncation).
    expect(elided[0]!.content).not.toContain('truncated for context');

    // The persisted transcript keeps every tool result in full.
    const persisted = (await service.listMessages(sessionId)) as Array<{
      role: string;
      content: string;
    }>;
    const persistedTool = persisted.filter((m) => m.role === 'tool');
    expect(persistedTool.length).toBeGreaterThan(0);
    for (const m of persistedTool) expect(m.content).toBe(BIG);
  });

  it('leaves history untouched when under the token budget', async () => {
    const SMALL = 'z'.repeat(300);
    let finalRoundMessages: Array<{ role: string; content: string }> = [];

    const { service } = makeStreamingService({
      maxToolRounds: 2,
      maxContextTokens: 1_000_000, // effectively unlimited
      maxToolOutputChars: 100_000,
      echoExecute: async () => ({ ok: true as const, content: SMALL }),
      invokeStream: async function* (request) {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        if (request.tools && request.tools.length > 0) {
          yield ok({
            type: 'stream.tool_call',
            toolCall: { id: 'tc_1', name: 'echo', arguments: {} },
          });
          yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
        } else {
          finalRoundMessages =
            (request as { messages?: Array<{ role: string; content: string }> })
              .messages ?? [];
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('No compact');
    await submit(service, (session as { id: string }).id);

    const toolMsg = finalRoundMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe(SMALL);
    expect(toolMsg?.content).not.toContain('elided');
  });
});

// ============================================================================
// Cross-run history — stale tool-output trimming (issue #438)
// ============================================================================

describe('SessionMessageService — stale history tool-output trimming', () => {
  it('summarizes older prior-run tool results on replay but keeps the most recent full', async () => {
    const BIG = 'H'.repeat(600); // > the 500-char summarize threshold
    let replayedMessages: Array<{ role: string; content: string }> = [];

    const { service } = makeStreamingService({
      maxToolRounds: 3,
      historyToolResultsKept: 1, // keep only the most recent tool result full
      maxContextTokens: 10_000_000, // don't let #437 (budget) interfere
      maxToolOutputChars: 100_000, // don't let #436 (per-result cap) interfere
      echoExecute: async () => ({ ok: true as const, content: BIG }),
      invokeStream: async function* (request) {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        const msgs =
          (request as { messages?: Array<{ role: string; content: string }> })
            .messages ?? [];
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        // Second submit: capture the replayed history and answer immediately.
        if (lastUser?.content.includes('inspect')) {
          replayedMessages = msgs;
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
          return;
        }
        // First submit: chain tool calls to populate two prior tool results.
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
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('History');
    const sessionId = (session as { id: string }).id;

    // Submit 1: produces two tool results (rounds 0 and 1), persisted.
    await submit(service, sessionId, 'populate the task');
    // Submit 2: replays history — trimming should apply.
    await submit(service, sessionId, 'inspect now');

    const toolMsgs = replayedMessages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(2);
    // Oldest is summarized…
    expect(toolMsgs[0]!.content).toContain('Prior tool result elided');
    expect(toolMsgs[0]!.content).not.toBe(BIG);
    // …most recent kept full.
    expect(toolMsgs[1]!.content).toBe(BIG);

    // Transcript keeps both results in full regardless.
    const persisted = (await service.listMessages(sessionId)) as Array<{
      role: string;
      content: string;
    }>;
    const persistedTool = persisted.filter((m) => m.role === 'tool');
    expect(persistedTool.length).toBe(2);
    for (const m of persistedTool) expect(m.content).toBe(BIG);
  });
});

// ============================================================================
// Agentic loop — degenerate empty-turn retry (issue #439)
// ============================================================================

describe('SessionMessageService — degenerate empty-turn retry', () => {
  it('retries a finish_reason=tool_calls turn that emits no tool call and no content, then recovers', async () => {
    let calls = 0;
    const { service, invokeStream } = makeStreamingService({
      maxToolRounds: 3,
      invokeStream: async function* () {
        const n = calls++;
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        if (n === 0) {
          // Degenerate: signals tool_calls but streams nothing parseable.
          yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
        } else {
          yield ok({ type: 'stream.content_delta', delta: 'recovered' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('Retry');
    const result = await submit(service, (session as { id: string }).id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Recovered on the retry — a real answer, not the fallback message.
    expect(result.assistantMessage.content).toBe('recovered');
    // Original + one retry (retry does not consume a tool round).
    expect(invokeStream).toHaveBeenCalledTimes(2);
  });

  it('falls back after exhausting retries when the turn stays degenerate', async () => {
    const { service, invokeStream } = makeStreamingService({
      maxToolRounds: 5,
      invokeStream: async function* () {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
      },
    });

    const session = await service.createSession('Retry exhausted');
    const result = await submit(service, (session as { id: string }).id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Never loops forever: original + MAX_EMPTY_TURN_RETRIES (2) = 3 calls.
    expect(invokeStream).toHaveBeenCalledTimes(3);
    // Then the #435 fallback keeps the user unblocked.
    expect(result.assistantMessage.content.toLowerCase()).toContain('continue');
  });
});

// ============================================================================
// Agentic loop — context observability (issue #440)
// ============================================================================

describe('SessionMessageService — context observability', () => {
  it('logs per-round context size and a per-run context summary', async () => {
    const { service, logger } = makeStreamingService({
      maxToolRounds: 3,
      invokeStream: async function* (request) {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        if (request.tools && request.tools.length > 0) {
          yield ok({
            type: 'stream.tool_call',
            toolCall: { id: 'tc_1', name: 'echo', arguments: {} },
          });
          yield ok({
            type: 'stream.usage',
            usage: { promptTokens: 123, completionTokens: 5, totalTokens: 128 },
          });
          yield ok({ type: 'stream.finished', finishReason: 'tool_calls' });
        } else {
          yield ok({ type: 'stream.content_delta', delta: 'done' });
          yield ok({ type: 'stream.finished', finishReason: 'stop' });
        }
      },
    });

    const session = await service.createSession('Obs');
    const result = await submit(service, (session as { id: string }).id);
    expect(result.ok).toBe(true);

    // Per-round debug log fired at least once.
    const roundLogs = logger.debug.mock.calls.filter(
      (c) => c[1] === 'Agentic loop round context size',
    );
    expect(roundLogs.length).toBeGreaterThan(0);
    expect(roundLogs[0]![0]).toMatchObject({
      round: expect.any(Number),
      estTokens: expect.any(Number),
      messageCount: expect.any(Number),
    });

    // Exactly one per-run summary, with the fields needed to tune the caps.
    const summaryLogs = logger.info.mock.calls.filter(
      (c) => c[1] === 'Agentic run context summary',
    );
    expect(summaryLogs).toHaveLength(1);
    const summary = summaryLogs[0]![0] as {
      roundsUsed: number;
      peakPromptTokens: number;
      peakEstTokens: number;
      compactionFired: boolean;
    };
    expect(summary.roundsUsed).toBeGreaterThan(0);
    expect(summary.peakPromptTokens).toBe(123); // captured from stream.usage
    expect(summary.peakEstTokens).toBeGreaterThan(0);
    expect(summary.compactionFired).toBe(false);
  });

  it('warns when a round nears the token budget', async () => {
    const { service, logger } = makeStreamingService({
      maxToolRounds: 2,
      maxContextTokens: 10, // tiny, so even the system prompt is "near" it
      invokeStream: async function* () {
        yield ok({ type: 'stream.started', providerId: 'mock', model: 'mock' });
        yield ok({ type: 'stream.content_delta', delta: 'done' });
        yield ok({ type: 'stream.finished', finishReason: 'stop' });
      },
    });

    const session = await service.createSession('Near budget');
    await submit(service, (session as { id: string }).id);

    const nearWarnings = logger.warn.mock.calls.filter(
      (c) => c[1] === 'Agentic loop request nearing the context token budget',
    );
    expect(nearWarnings.length).toBeGreaterThan(0);
  });
});
