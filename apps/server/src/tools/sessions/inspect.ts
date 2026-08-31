import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';
import { sessionsInspectMeta } from '../catalog.js';

interface ToolCallBucket {
  calls: number;
  firstAt: string | null;
  lastAt: string | null;
  lastCallerMessageId: string | null;
}

function readToolCalls(message: Record<string, unknown>): unknown[] {
  const direct = message['toolCalls'];
  if (Array.isArray(direct)) return direct;
  const metadata = message['metadata'];
  if (metadata && typeof metadata === 'object') {
    const stored = (metadata as Record<string, unknown>)['toolCalls'];
    if (Array.isArray(stored)) return stored;
  }
  return [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function pickEarliest(
  current: string | null,
  candidate: string | null,
): string | null {
  if (current === null) return candidate;
  if (candidate === null) return current;
  return Date.parse(current) <= Date.parse(candidate) ? current : candidate;
}

function pickLatest(
  current: string | null,
  candidate: string | null,
): string | null {
  if (current === null) return candidate;
  if (candidate === null) return current;
  return Date.parse(current) >= Date.parse(candidate) ? current : candidate;
}

export function createSessionsInspectTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: sessionsInspectMeta.name,
    description: sessionsInspectMeta.description,
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to inspect.',
        },
      },
      required: ['sessionId'],
    },

    async execute(args, _ctx) {
      const sessionId = args['sessionId'];

      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return {
          ok: false,
          error: 'sessionId is required and must be a non-empty string',
        };
      }

      try {
        const sessionService = deps.getSessionService();
        const session = await sessionService.getSession(sessionId.trim());

        if (!session) {
          return {
            ok: false,
            error: `Session "${sessionId}" not found. Use sessions_list to see available sessions.`,
          };
        }

        const s = session as Record<string, unknown>;
        const messages = await sessionService.listMessages(sessionId.trim());
        const runs = await sessionService.listRuns(sessionId.trim());

        const roleCounts: Record<string, number> = {
          system: 0,
          user: 0,
          assistant: 0,
          tool: 0,
        };
        const toolInventory = new Map<string, ToolCallBucket>();
        let totalContentChars = 0;
        let lastMessageAt: string | null = null;

        for (const m of messages) {
          const r = m as Record<string, unknown>;
          const role = asString(r['role']);
          if (role !== null && role in roleCounts) {
            roleCounts[role] = (roleCounts[role] ?? 0) + 1;
          }
          if (role !== 'tool') {
            const content = r['content'];
            if (typeof content === 'string') {
              totalContentChars += content.length;
            }
          }
          const createdAt = asString(r['createdAt']);
          if (createdAt !== null) {
            lastMessageAt = pickLatest(lastMessageAt, createdAt);
          }
          if (role !== 'assistant') continue;
          for (const tc of readToolCalls(r)) {
            const rec = tc as Record<string, unknown>;
            const name = asString(rec['name']);
            if (name === null) continue;
            const bucket = toolInventory.get(name) ?? {
              calls: 0,
              firstAt: null,
              lastAt: null,
              lastCallerMessageId: null,
            };
            bucket.calls += 1;
            bucket.firstAt = pickEarliest(bucket.firstAt, createdAt);
            bucket.lastAt = pickLatest(bucket.lastAt, createdAt);
            const messageId = asString(r['id']);
            if (messageId !== null) bucket.lastCallerMessageId = messageId;
            toolInventory.set(name, bucket);
          }
        }

        const sortedRuns = [...runs].sort((a, b) => {
          const aTime = Date.parse(
            asString((a as Record<string, unknown>)['createdAt']) ?? '',
          );
          const bTime = Date.parse(
            asString((b as Record<string, unknown>)['createdAt']) ?? '',
          );
          return bTime - aTime;
        });
        const lastRunRecord = sortedRuns[0];
        const lastRun = lastRunRecord
          ? (() => {
              const rec = lastRunRecord as Record<string, unknown>;
              return {
                id: rec['id'] ?? null,
                agentId: rec['agentId'] ?? null,
                status: rec['status'] ?? null,
                finishReason: rec['finishReason'] ?? null,
                errorCode: rec['errorCode'] ?? null,
                errorMessage: rec['errorMessage'] ?? null,
                createdAt: rec['createdAt'] ?? null,
              };
            })()
          : null;

        const toolCallInventory = [...toolInventory.entries()]
          .map(([toolName, bucket]) => ({
            toolName,
            calls: bucket.calls,
            firstAt: bucket.firstAt,
            lastAt: bucket.lastAt,
            lastCallerMessageId: bucket.lastCallerMessageId,
          }))
          .sort((a, b) => b.calls - a.calls);

        const result = {
          id: s['id'],
          title: s['title'],
          status: s['status'] ?? null,
          createdAt: s['createdAt'] ?? null,
          messageCount: messages.length,
          runCount: runs.length,
          roleCounts,
          totalContentChars,
          lastMessageAt,
          lastRun,
          toolCallInventory,
        };

        return {
          ok: true,
          content: JSON.stringify(result, null, 2),
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
