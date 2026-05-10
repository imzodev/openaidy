import { describe, it, expect, vi } from 'vitest';
import { createAgentsInvokeTool, createAgentTools } from './index.js';
import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentRegistry } from '../../agents/registry.js';
import type { SessionMessageService } from '../../sessions/service.js';

const CTX = { agentId: 'test-agent' };

function makeAgentRegistry(
  overrides: Partial<{
    getAgent: ReturnType<typeof vi.fn>;
    listAgents: ReturnType<typeof vi.fn>;
  }> = {},
): AgentRegistry {
  return {
    getAgent: vi.fn().mockReturnValue({
      id: 'researcher',
      name: 'Researcher',
      enabled: true,
      model: 'openai/gpt-4o',
      systemPrompt: 'You are a researcher.',
    }),
    listAgents: vi
      .fn()
      .mockReturnValue([
        { id: 'researcher', name: 'Researcher', model: 'openai/gpt-4o' },
      ]),
    ...overrides,
  } as unknown as AgentRegistry;
}

function makeSessionService(
  overrides: Partial<Record<keyof SessionMessageService, unknown>> = {},
): SessionMessageService {
  return {
    dispatchAgent: vi.fn().mockResolvedValue({
      ok: true,
      sessionId: 'sess-abc',
      done: Promise.resolve({
        ok: true,
        assistantMessage: { content: 'response from agent' },
      }),
    }),
    submitMessageStreaming: vi.fn().mockResolvedValue({
      ok: true,
      assistantMessage: { content: 'response' },
    }),
    ...overrides,
  } as unknown as SessionMessageService;
}

function makeDeps(opts: {
  agentRegistry?: AgentRegistry;
  sessionSvc?: SessionMessageService;
}) {
  return {
    registry: opts.agentRegistry ?? makeAgentRegistry(),
    getSessionService: () => opts.sessionSvc ?? makeSessionService(),
  };
}

// Helper to get a resolved tool result from the async execute
async function executeTool(
  tool: BuiltinTool,
  args: Record<string, unknown>,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  return tool.execute(args, CTX);
}

// ──────────────────────────────────────────────────────────────────────────────

describe('agents_invoke tool', () => {
  function makeTool(opts?: {
    agentRegistry?: AgentRegistry;
    sessionSvc?: SessionMessageService;
  }) {
    return createAgentsInvokeTool(makeDeps(opts ?? {}));
  }

  // ── createAgentTools factory ─────────────────────────────────────────────────

  describe('createAgentTools', () => {
    it('includes agents_invoke', () => {
      const tools = createAgentTools(makeDeps({}));
      const names = tools.map((t) => t.name);
      expect(names).toContain('agents_invoke');
    });
  });

  // ── Tool metadata ────────────────────────────────────────────────────────────

  it('has the correct name', () => {
    expect(makeTool().name).toBe('agents_invoke');
  });

  it('requires agentId and content', () => {
    const required = (
      makeTool().parameters as unknown as { required: string[] }
    ).required;
    expect(required).toContain('agentId');
    expect(required).toContain('content');
    expect(required).not.toContain('sessionId'); // optional
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  it('rejects missing agentId', async () => {
    const result = await executeTool(makeTool(), { content: 'hello' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/agentId is required/);
  });

  it('rejects empty agentId', async () => {
    const result = await executeTool(makeTool(), {
      agentId: '   ',
      content: 'hello',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/agentId is required/);
  });

  it('rejects missing content', async () => {
    const result = await executeTool(makeTool(), { agentId: 'researcher' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/content is required/);
  });

  it('rejects empty content', async () => {
    const result = await executeTool(makeTool(), {
      agentId: 'researcher',
      content: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/content is required/);
  });

  it('rejects non-string agentId', async () => {
    const result = await executeTool(makeTool(), {
      agentId: 123,
      content: 'hello',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/agentId is required/);
  });

  // ── Session service unavailable ──────────────────────────────────────────────

  it('returns error when session service is not available', async () => {
    const deps = { ...makeDeps({}), getSessionService: undefined };
    const tool = createAgentsInvokeTool(deps as never);
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'hello',
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/Session service is not available/);
  });

  // ── dispatchAgent error propagation ─────────────────────────────────────────

  it('propagates dispatchAgent errors', async () => {
    const svc = makeSessionService({
      dispatchAgent: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'Agent not found.' }),
    });
    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'missing-agent',
      content: 'hello',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Agent not found.');
  });

  // ── Success: new session ─────────────────────────────────────────────────────

  it('creates a new session and dispatches (no sessionId provided)', async () => {
    const svc = makeSessionService();
    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'Research quantum computing',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('sess-abc');
      expect(result.content).toContain('researcher');
      expect(result.content).toContain('Created new session');
      expect(result.content).toContain('sessions_read');
    }

    expect(svc.dispatchAgent).toHaveBeenCalledWith({
      agentId: 'researcher',
      content: 'Research quantum computing',
    });
  });

  // ── Success: existing session ────────────────────────────────────────────────

  it('uses existing session when sessionId is provided', async () => {
    const svc = makeSessionService();
    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'Continue research',
      sessionId: 'sess-existing',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('sess-abc');
      expect(result.content).not.toContain('Created new session');
    }

    expect(svc.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'researcher',
        content: 'Continue research',
        sessionId: 'sess-existing',
      }),
    );
  });

  // ── Fire-and-forget behaviour ────────────────────────────────────────────────

  it('does not wait for the agent to finish (fire-and-forget)', async () => {
    let resolved = false;
    const svc = makeSessionService({
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-abc',
        done: new Promise((resolve) =>
          setTimeout(() => {
            resolved = true;
            resolve({ ok: true, assistantMessage: { content: 'done' } });
          }, 100),
        ),
      }),
    });
    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'hello',
    });

    expect(result.ok).toBe(true);
    expect(resolved).toBe(false);
  });

  // ── Integration: createAgentTools returns all expected tools ─────────────────

  it('createAgentTools returns agents_list, agents_create, and agents_invoke', () => {
    const tools = createAgentTools(makeDeps({}));
    const names = tools.map((t) => t.name);
    expect(names).toContain('agents_list');
    expect(names).toContain('agents_create');
    expect(names).toContain('agents_invoke');
    expect(names).toHaveLength(3);
  });
});
