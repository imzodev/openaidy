import { describe, it, expect, vi } from 'vitest';
import {
  createSessionTools,
  createSessionsCreateTool,
  createSessionsInspectTool,
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
    findMessageById: vi.fn().mockImplementation(async (id: string) => {
      const messages = [
        {
          id: 'msg-1',
          sessionId: 'sess-1',
          role: 'user',
          content: 'Hello',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ];
      return messages.find((m) => m.id === id) ?? null;
    }),
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
    it('returns all five session tools', () => {
      const svc = makeSessionService();
      const tools = createSessionTools(makeDeps(svc));
      const names = tools.map((t) => t.name);
      expect(names).toContain('sessions_create');
      expect(names).toContain('sessions_list');
      expect(names).toContain('sessions_read');
      expect(names).toContain('sessions_inspect');
      expect(names).toContain('sessions_send');
      expect(names).toHaveLength(5);
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

    it('returns only the last N messages when fromEnd+limit are set', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'first',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'second',
            createdAt: '2025-01-01T00:00:01Z',
          },
          {
            id: 'm3',
            role: 'user',
            content: 'third',
            createdAt: '2025-01-01T00:00:02Z',
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', fromEnd: true, limit: 2 },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages).toHaveLength(2);
        expect(parsed.messages[0].id).toBe('m2');
        expect(parsed.messages[1].id).toBe('m3');
        expect(parsed.messageCount).toBe(3);
        expect(parsed.truncated).toBe(true);
      }
    });

    it('respects offset and order=desc', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'a',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'user',
            content: 'b',
            createdAt: '2025-01-01T00:00:01Z',
          },
          {
            id: 'm3',
            role: 'user',
            content: 'c',
            createdAt: '2025-01-01T00:00:02Z',
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', order: 'desc', offset: 1, limit: 1 },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0].id).toBe('m2');
      }
    });

    it('filters messages by role', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'u1',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'a1',
            createdAt: '2025-01-01T00:00:01Z',
          },
          {
            id: 'm3',
            role: 'user',
            content: 'u2',
            createdAt: '2025-01-01T00:00:02Z',
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', role: 'user' },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages.map((m: { id: string }) => m.id)).toEqual([
          'm1',
          'm3',
        ]);
        expect(parsed.filteredMessageCount).toBe(2);
      }
    });

    it('rejects invalid role values', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { sessionId: 'sess-1', role: 'bogus' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/role must be one of/);
    });

    it('rejects invalid order values', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { sessionId: 'sess-1', order: 'sideways' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(/order must be "asc" or "desc"/);
    });

    it('rejects negative limit and offset', async () => {
      const tool = makeTool();
      const r1 = await tool.execute({ sessionId: 'sess-1', limit: -1 }, CTX);
      expect(r1.ok).toBe(false);
      const r2 = await tool.execute({ sessionId: 'sess-1', offset: -5 }, CTX);
      expect(r2.ok).toBe(false);
    });

    it('omits messages array when includeMessages=false', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { sessionId: 'sess-1', includeMessages: false },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages).toBeUndefined();
        expect(parsed.runs).toHaveLength(1);
        expect(parsed.runCount).toBe(1);
      }
    });

    it('omits runs array when includeRuns=false', async () => {
      const tool = makeTool();
      const result = await tool.execute(
        { sessionId: 'sess-1', includeRuns: false },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.runs).toBeUndefined();
        expect(parsed.runCount).toBeUndefined();
        expect(parsed.messages).toHaveLength(1);
      }
    });

    it('reports filteredMessageCount consistently when includeMessages=false', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'u1',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'a1',
            createdAt: '2025-01-01T00:00:01Z',
          },
          {
            id: 'm3',
            role: 'user',
            content: 'u2',
            createdAt: '2025-01-01T00:00:02Z',
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', role: 'user', includeMessages: false },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messageCount).toBe(3);
        expect(parsed.filteredMessageCount).toBe(2);
        expect(parsed.messages).toBeUndefined();
      }
    });

    it('returns full content when fullContent=true', async () => {
      const longContent = 'a'.repeat(800);
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'assistant',
            content: longContent,
            createdAt: '2025-01-01T00:00:00Z',
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', fullContent: true },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages[0].content).toBe(longContent);
      }
    });

    it('fetches a single message with full content when messageId is set', async () => {
      const longContent = 'a'.repeat(800);
      const tool = makeTool({
        findMessageById: vi.fn().mockImplementation(async (id: string) => {
          if (id === 'm2') {
            return {
              id: 'm2',
              sessionId: 'sess-1',
              role: 'assistant',
              content: longContent,
              createdAt: '2025-01-01T00:00:01Z',
            };
          }
          return null;
        }),
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'short',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: longContent,
            createdAt: '2025-01-01T00:00:01Z',
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', messageId: 'm2' },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0].id).toBe('m2');
        expect(parsed.messages[0].content).toBe(longContent);
        expect(parsed.messageCount).toBe(1);
      }
    });

    it('returns error when messageId does not exist', async () => {
      const tool = makeTool({
        findMessageById: vi.fn().mockResolvedValue(null),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', messageId: 'missing' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(/Message "missing" not found/);
    });

    it('does not load the full transcript when messageId is set', async () => {
      const listSpy = vi.fn().mockResolvedValue([]);
      const findSpy = vi.fn().mockImplementation(async (id: string) =>
        id === 'm42'
          ? {
              id: 'm42',
              sessionId: 'sess-1',
              role: 'assistant',
              content: 'hello',
              createdAt: '2025-01-01T00:00:00Z',
            }
          : null,
      );
      const tool = makeTool({
        listMessages: listSpy,
        findMessageById: findSpy,
      });
      await tool.execute({ sessionId: 'sess-1', messageId: 'm42' }, CTX);
      expect(listSpy).not.toHaveBeenCalled();
      expect(findSpy).toHaveBeenCalledWith('m42');
    });

    it('rejects a messageId that belongs to a different session', async () => {
      const tool = makeTool({
        findMessageById: vi.fn().mockResolvedValue({
          id: 'm99',
          sessionId: 'other-session',
          role: 'user',
          content: 'leaked',
          createdAt: '2025-01-01T00:00:00Z',
        }),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', messageId: 'm99' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(
          /Message "m99" not found in session "sess-1"/,
        );
    });

    it('includes toolCalls per message when includeToolCalls=true', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'assistant',
            content: '',
            createdAt: '2025-01-01T00:00:00Z',
            metadata: {
              toolCalls: [
                {
                  id: 'tc-1',
                  name: 'workspace_read',
                  arguments: '{"path":"a.txt"}',
                },
              ],
            },
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', includeToolCalls: true },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages[0].toolCalls).toEqual([
          {
            id: 'tc-1',
            name: 'workspace_read',
            arguments: '{"path":"a.txt"}',
          },
        ]);
      }
    });

    it('truncates oversized tool-call arguments', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'assistant',
            content: '',
            createdAt: '2025-01-01T00:00:00Z',
            toolCalls: [
              {
                id: 'tc-1',
                name: 'workspace_write',
                arguments: 'x'.repeat(500),
              },
            ],
          },
        ]),
      });
      const result = await tool.execute(
        { sessionId: 'sess-1', includeToolCalls: true },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        const args = parsed.messages[0].toolCalls[0].arguments;
        expect(args.endsWith('...')).toBe(true);
        expect(args.length).toBeLessThanOrEqual(203);
      }
    });

    it('omits toolCalls when includeToolCalls=false (default)', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'assistant',
            content: 'x',
            createdAt: '2025-01-01T00:00:00Z',
            toolCalls: [
              { id: 'tc-1', name: 'workspace_read', arguments: '{}' },
            ],
          },
        ]),
      });
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.messages[0].toolCalls).toBeUndefined();
      }
    });
  });

  // ─── sessions_inspect ────────────────────────────────────────────────────────

  describe('sessions_inspect', () => {
    function makeTool(
      svcOverrides?: Partial<Record<keyof SessionMessageService, unknown>>,
    ) {
      return createSessionsInspectTool(
        makeDeps(makeSessionService(svcOverrides)),
      );
    }

    it('has the correct name', () => {
      expect(makeTool().name).toBe('sessions_inspect');
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

    it('returns error when session not found', async () => {
      const tool = makeTool({
        getSession: vi.fn().mockResolvedValue(null),
      });
      const result = await tool.execute({ sessionId: 'missing' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/);
    });

    it('returns counts, role counts, last run, and tool-call inventory without message bodies', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '',
            createdAt: '2025-01-01T00:00:01Z',
            metadata: {
              toolCalls: [
                { id: 'tc-1', name: 'workspace_read', arguments: '{}' },
                { id: 'tc-2', name: 'exec_run', arguments: '{}' },
              ],
            },
          },
          {
            id: 'm3',
            role: 'tool',
            content: 'tool-result',
            createdAt: '2025-01-01T00:00:02Z',
          },
          {
            id: 'm4',
            role: 'assistant',
            content: '',
            createdAt: '2025-01-01T00:00:03Z',
            metadata: {
              toolCalls: [
                { id: 'tc-3', name: 'workspace_read', arguments: '{}' },
              ],
            },
          },
        ]),
        listRuns: vi.fn().mockResolvedValue([
          {
            id: 'r1',
            agentId: 'a1',
            status: 'succeeded',
            finishReason: 'stop',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'r2',
            agentId: 'a1',
            status: 'failed',
            finishReason: 'error',
            errorCode: 'TOOL_ERROR',
            errorMessage: 'boom',
            createdAt: '2025-01-01T00:00:04Z',
          },
        ]),
      });

      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.id).toBe('sess-1');
        expect(parsed.title).toBe('Test Session');
        expect(parsed.messageCount).toBe(4);
        expect(parsed.runCount).toBe(2);
        expect(parsed.roleCounts).toEqual({
          system: 0,
          user: 1,
          assistant: 2,
          tool: 1,
        });
        expect(parsed.totalContentChars).toBe('hi'.length);
        expect(parsed.lastMessageAt).toBe('2025-01-01T00:00:03Z');
        expect(parsed.lastRun).toEqual({
          id: 'r2',
          agentId: 'a1',
          status: 'failed',
          finishReason: 'error',
          errorCode: 'TOOL_ERROR',
          errorMessage: 'boom',
          createdAt: '2025-01-01T00:00:04Z',
        });
        expect(parsed.toolCallInventory).toEqual([
          {
            toolName: 'workspace_read',
            calls: 2,
            firstAt: '2025-01-01T00:00:01Z',
            lastAt: '2025-01-01T00:00:03Z',
            lastCallerMessageId: 'm4',
          },
          {
            toolName: 'exec_run',
            calls: 1,
            firstAt: '2025-01-01T00:00:01Z',
            lastAt: '2025-01-01T00:00:01Z',
            lastCallerMessageId: 'm2',
          },
        ]);
        expect(JSON.stringify(parsed)).not.toContain('tool-result');
        expect(JSON.stringify(parsed).includes('hi')).toBe(false);
      }
    });

    it('excludes tool-message content from totalContentChars', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            createdAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'tool',
            content: 'x'.repeat(10_000),
            createdAt: '2025-01-01T00:00:01Z',
          },
        ]),
        listRuns: vi.fn().mockResolvedValue([]),
      });
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.totalContentChars).toBe('hi'.length);
      }
    });

    it('only attributes tool calls to assistant messages', async () => {
      const tool = makeTool({
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            createdAt: '2025-01-01T00:00:00Z',
            metadata: {
              toolCalls: [
                { id: 'tc-1', name: 'should_not_count', arguments: '{}' },
              ],
            },
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '',
            createdAt: '2025-01-01T00:00:01Z',
            metadata: {
              toolCalls: [{ id: 'tc-2', name: 'real_tool', arguments: '{}' }],
            },
          },
        ]),
        listRuns: vi.fn().mockResolvedValue([]),
      });
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.toolCallInventory).toEqual([
          {
            toolName: 'real_tool',
            calls: 1,
            firstAt: '2025-01-01T00:00:01Z',
            lastAt: '2025-01-01T00:00:01Z',
            lastCallerMessageId: 'm2',
          },
        ]);
      }
    });

    it('returns null lastRun when no runs exist', async () => {
      const tool = makeTool({
        listRuns: vi.fn().mockResolvedValue([]),
      });
      const result = await tool.execute({ sessionId: 'sess-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.lastRun).toBeNull();
        expect(parsed.toolCallInventory).toEqual([]);
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
