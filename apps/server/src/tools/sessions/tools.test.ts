import { describe, it, expect, vi } from 'vitest';
import {
  createSessionTools,
  createSessionsCreateTool,
  createSessionsListTool,
  createSessionsReadTool,
  createSessionsSendTool,
} from './index.js';
import type { SessionMessageService } from '../../sessions/service.js';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

function makeSessionService(
  overrides: Partial<Record<keyof SessionMessageService, unknown>> = {},
): SessionMessageService {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: 'sess-1',
      title: 'Test Session',
      createdAt: '2025-01-01T00:00:00Z',
    }),
    listSessions: vi.fn().mockResolvedValue([
      { id: 'sess-1', title: 'First', createdAt: '2025-01-01T00:00:00Z' },
      { id: 'sess-2', title: 'Second', createdAt: '2025-01-02T00:00:00Z' },
    ]),
    getSession: vi.fn().mockResolvedValue({
      id: 'sess-1',
      title: 'Test Session',
      createdAt: '2025-01-01T00:00:00Z',
    }),
    listMessages: vi.fn().mockResolvedValue([
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ]),
    listRuns: vi.fn().mockResolvedValue([
      {
        id: 'run-1',
        agentId: 'agent-1',
        status: 'succeeded',
        finishReason: 'stop',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ]),
    submitMessageStreaming: vi.fn().mockResolvedValue({
      ok: true,
      assistantMessage: { content: 'response' },
    }),
    ...overrides,
  } as unknown as SessionMessageService;
}

function makeDeps(svc: SessionMessageService) {
  return { getSessionService: () => svc };
}

// ──────────────────────────────────────────────────────────────────────────────

describe('session tools', () => {
  // ─── createSessionTools factory ──────────────────────────────────────────────

  describe('createSessionTools', () => {
    it('returns all four session tools', () => {
      const svc = makeSessionService();
      const tools = createSessionTools(makeDeps(svc));
      const names = tools.map((t) => t.name);
      expect(names).toContain('sessions_create');
      expect(names).toContain('sessions_list');
      expect(names).toContain('sessions_read');
      expect(names).toContain('sessions_send');
      expect(names).toHaveLength(4);
    });
  });

  // ─── sessions_create ─────────────────────────────────────────────────────────

  describe('sessions_create', () => {
    function makeTool(
      svcOverrides?: Partial<Record<keyof SessionMessageService, unknown>>,
    ) {
      return createSessionsCreateTool(
        makeDeps(makeSessionService(svcOverrides)),
      );
    }

    it('has the correct name', () => {
      expect(makeTool().name).toBe('sessions_create');
    });

    it('requires title', () => {
      const required = (
        makeTool().parameters as unknown as { required: string[] }
      ).required;
      expect(required).toContain('title');
    });

    it('rejects missing title', async () => {
      const result = await makeTool().execute({}, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/title is required/);
    });

    it('rejects empty title', async () => {
      const result = await makeTool().execute({ title: '   ' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/title is required/);
    });

    it('rejects non-string title', async () => {
      const result = await makeTool().execute({ title: 123 }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/title is required/);
    });

    it('creates a session and returns id and title', async () => {
      const tool = makeTool();
      const result = await tool.execute({ title: 'My Session' }, CTX);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.id).toBe('sess-1');
        expect(parsed.title).toBe('Test Session');
      }
    });

    it('returns error when createSession throws', async () => {
      const tool = makeTool({
        createSession: vi.fn().mockRejectedValue(new Error('DB down')),
      });
      const result = await tool.execute({ title: 'test' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('DB down');
    });
  });

  // ─── sessions_list ───────────────────────────────────────────────────────────

  describe('sessions_list', () => {
    function makeTool(
      svcOverrides?: Partial<Record<keyof SessionMessageService, unknown>>,
    ) {
      return createSessionsListTool(makeDeps(makeSessionService(svcOverrides)));
    }

    it('has the correct name', () => {
      expect(makeTool().name).toBe('sessions_list');
    });

    it('has no required parameters', () => {
      const required = (
        makeTool().parameters as unknown as { required: string[] }
      ).required;
      expect(required).toHaveLength(0);
    });

    it('lists sessions with id, title, and createdAt', async () => {
      const tool = makeTool();
      const result = await tool.execute({}, CTX);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('sess-1');
        expect(result.content).toContain('First');
        expect(result.content).toContain('sess-2');
        expect(result.content).toContain('Second');
        expect(result.content).toContain('session(s)');
      }
    });

    it('returns empty message when no sessions exist', async () => {
      const tool = makeTool({
        listSessions: vi.fn().mockResolvedValue([]),
      });
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe('No sessions found.');
    });

    it('returns error when listSessions throws', async () => {
      const tool = makeTool({
        listSessions: vi.fn().mockRejectedValue(new Error('DB error')),
      });
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('DB error');
    });
  });

  // ─── sessions_read ───────────────────────────────────────────────────────────

  describe('sessions_read', () => {
    function makeTool(
      svcOverrides?: Partial<Record<keyof SessionMessageService, unknown>>,
    ) {
      return createSessionsReadTool(makeDeps(makeSessionService(svcOverrides)));
    }

    it('has the correct name', () => {
      expect(makeTool().name).toBe('sessions_read');
    });

    it('requires sessionId', () => {
      const required = (
        makeTool().parameters as unknown as { required: string[] }
      ).required;
      expect(required).toContain('sessionId');
    });

    it('rejects missing sessionId', async () => {
      const result = await makeTool().execute({}, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/sessionId is required/);
    });

    it('rejects empty sessionId', async () => {
      const result = await makeTool().execute({ sessionId: '   ' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/sessionId is required/);
    });

    it('returns error when session not found', async () => {
      const tool = makeTool({
        getSession: vi.fn().mockResolvedValue(null),
      });
      const result = await tool.execute({ sessionId: 'missing' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/);
    });

    it('returns session metadata, messages, and runs', async () => {
      const tool = makeTool();
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.id).toBe('sess-1');
        expect(parsed.title).toBe('Test Session');
        expect(parsed.messageCount).toBe(1);
        expect(parsed.messages[0].role).toBe('user');
        expect(parsed.runCount).toBe(1);
        expect(parsed.runs[0].status).toBe('succeeded');
      }
    });

    it('truncates long message content', async () => {
      const longContent = 'a'.repeat(600);
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'msg-1',
            role: 'assistant',
            content: longContent,
            createdAt: '2025-01-01T00:00:00Z',
          },
        ]),
      });
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages[0].content).toHaveLength(503); // 500 + '...'
        expect(parsed.messages[0].content).toMatch(/\.{3}$/);
      }
    });

    it('returns error when getSession throws', async () => {
      const tool = makeTool({
        getSession: vi.fn().mockRejectedValue(new Error('DB error')),
      });
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('DB error');
    });
  });

  // ─── sessions_send ───────────────────────────────────────────────────────────

  describe('sessions_send', () => {
    function makeTool(
      svcOverrides?: Partial<Record<keyof SessionMessageService, unknown>>,
    ) {
      return createSessionsSendTool(makeDeps(makeSessionService(svcOverrides)));
    }

    it('has the correct name', () => {
      expect(makeTool().name).toBe('sessions_send');
    });

    it('requires sessionId and content', () => {
      const required = (
        makeTool().parameters as unknown as { required: string[] }
      ).required;
      expect(required).toContain('sessionId');
      expect(required).toContain('content');
    });

    it('rejects missing sessionId', async () => {
      const result = await makeTool().execute({ content: 'hello' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/sessionId is required/);
    });

    it('rejects missing content', async () => {
      const result = await makeTool().execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/content is required/);
    });

    it('returns error when session not found', async () => {
      const tool = makeTool({
        getSession: vi.fn().mockResolvedValue(null),
      });
      const result = await tool.execute(
        { sessionId: 'missing', content: 'hello' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/);
    });

    it('dispatches message and returns sessionId', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { sessionId: 'sess-1', content: 'Hello world' },
        CTX,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('sess-1');
        expect(result.content).toContain('Dispatched');
        expect(result.content).toContain('sessions_read');
      }
    });

    it('dispatches with agentId when provided', async () => {
      const svc = makeSessionService();
      const tool = createSessionsSendTool(makeDeps(svc));
      const result = await tool.execute(
        { sessionId: 'sess-1', content: 'hello', agentId: 'researcher' },
        CTX,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('researcher');
      }
      expect(svc.submitMessageStreaming).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          content: 'hello',
          agentId: 'researcher',
        }),
      );
    });

    it('does not wait for the dispatch to complete', async () => {
      // submitMessageStreaming takes a long time — tool returns immediately
      let resolved = false;
      const svc = makeSessionService({
        submitMessageStreaming: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => {
                resolved = true;
                resolve({ ok: true, assistantMessage: { content: 'ok' } });
              }, 100),
            ),
        ),
      });
      const tool = createSessionsSendTool(makeDeps(svc));
      const result = await tool.execute(
        { sessionId: 'sess-1', content: 'hello' },
        CTX,
      );

      expect(result.ok).toBe(true);
      // Tool returned immediately before the promise resolved
      expect(resolved).toBe(false);
    });
  });
});
