import { describe, it, expect, vi } from 'vitest';
import {
  createAgentsInvokeTool,
  createAgentsInvokeAndWaitTool,
  createAgentTools,
} from './index.js';
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
    expect(names).toContain('agents_invoke_await');
    expect(names).toHaveLength(4);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// agents_invoke_await tests
// ──────────────────────────────────────────────────────────────────────────────

describe('agents_invoke_await tool', () => {
  function makeTool(opts?: {
    agentRegistry?: AgentRegistry;
    sessionSvc?: SessionMessageService;
  }) {
    return createAgentsInvokeAndWaitTool(makeDeps(opts ?? {}));
  }

  // ── Tool metadata ────────────────────────────────────────────────────────────

  it('has the correct name', () => {
    expect(makeTool().name).toBe('agents_invoke_await');
  });

  it('requires agentId and content', () => {
    const required = (
      makeTool().parameters as unknown as { required: string[] }
    ).required;
    expect(required).toContain('agentId');
    expect(required).toContain('content');
    expect(required).not.toContain('sessionId');
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

  // ── Session service unavailable ──────────────────────────────────────────────

  it('returns error when session service is not available', async () => {
    const deps = { ...makeDeps({}), getSessionService: undefined };
    const tool = createAgentsInvokeAndWaitTool(deps as never);
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'hello',
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/Session service is not available/);
  });

  // ── Success with polling ────────────────────────────────────────────────────

  it('waits for agent completion and returns response', async () => {
    let callCount = 0;
    const svc = makeSessionService({
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-abc',
        done: Promise.resolve({
          ok: true,
          assistantMessage: { content: 'Agent response' },
        }),
      }),
      listRuns: vi.fn().mockImplementation(() => {
        callCount++;
        // First call: running, second call: succeeded
        if (callCount === 1) {
          return Promise.resolve([{ id: 'run-1', status: 'running' }]);
        }
        return Promise.resolve([{ id: 'run-1', status: 'succeeded' }]);
      }),
      listMessages: vi.fn().mockResolvedValue([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Agent response' },
      ]),
    });

    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'hello',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain(
        'Agent "researcher" completed successfully',
      );
      expect(result.content).toContain('Agent response');
    }
    expect(callCount).toBe(2);
  });

  // ── Agent failure handling ───────────────────────────────────────────────────

  it('returns error when agent fails', async () => {
    const svc = makeSessionService({
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-abc',
        done: Promise.resolve({
          ok: true,
          assistantMessage: { content: 'response' },
        }),
      }),
      listRuns: vi
        .fn()
        .mockResolvedValue([
          { id: 'run-1', status: 'failed', errorMessage: 'Agent crashed' },
        ]),
    });

    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'hello',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('failed');
      expect(result.error).toContain('Agent crashed');
    }
  });

  // ── Timeout handling ─────────────────────────────────────────────────────────

  it('returns timeout error when agent takes too long', async () => {
    const svc = makeSessionService({
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-abc',
        done: Promise.resolve({
          ok: true,
          assistantMessage: { content: 'response' },
        }),
      }),
      listRuns: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'running' }]),
    });

    const tool = makeTool({ sessionSvc: svc });
    const result = await executeTool(tool, {
      agentId: 'researcher',
      content: 'hello',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Timeout');
      expect(result.error).toContain('30s');
    }
  }, 35000); // 35 second timeout for this test

  // ── Cancellation (issue #376) ────────────────────────────────────────────────

  it('bails out immediately when ctx.signal is already aborted', async () => {
    const svc = makeSessionService({
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-abc',
        done: Promise.resolve({ ok: true }),
      }),
      listRuns: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'running' }]),
    });
    const tool = makeTool({ sessionSvc: svc });
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      { agentId: 'researcher', content: 'hello' },
      { agentId: 'test-agent', signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Cancelled by user while waiting/);
    }
    // The dispatched sub-agent is NOT cancelled — dispatch still happened.
    expect(svc.dispatchAgent).toHaveBeenCalledTimes(1);
  });

  it('wakes from the poll backoff and cancels when aborted mid-wait', async () => {
    const svc = makeSessionService({
      dispatchAgent: vi.fn().mockResolvedValue({
        ok: true,
        sessionId: 'sess-abc',
        done: Promise.resolve({ ok: true }),
      }),
      listRuns: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'running' }]),
    });
    const tool = makeTool({ sessionSvc: svc });
    const controller = new AbortController();
    // Abort partway through the first 2s backoff interval.
    setTimeout(() => controller.abort(), 50);

    const start = Date.now();
    const result = await tool.execute(
      { agentId: 'researcher', content: 'hello' },
      { agentId: 'test-agent', signal: controller.signal },
    );
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Cancelled by user while waiting/);
    }
    // Must have woken well before the full 2s backoff interval elapsed.
    expect(elapsed).toBeLessThan(1500);
  }, 10000);

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
});
