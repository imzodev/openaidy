import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';
import { sessionsReadMeta } from '../catalog.js';

const MAX_TOOL_ARGS_PREVIEW_CHARS = 200;
const MAX_CONTENT_PREVIEW_CHARS = 500;
const ROLE_VALUES = ['system', 'user', 'assistant', 'tool'] as const;

function readStringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readBooleanArg(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

function truncateContent(content: unknown, fullContent: boolean): unknown {
  if (fullContent) return content;
  if (typeof content !== 'string') return content;
  if (content.length <= MAX_CONTENT_PREVIEW_CHARS) return content;
  return content.slice(0, MAX_CONTENT_PREVIEW_CHARS) + '...';
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

function buildMessageItem(
  message: Record<string, unknown>,
  fullContent: boolean,
  includeToolCalls: boolean,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: message['id'] ?? null,
    role: message['role'],
    content: truncateContent(message['content'], fullContent),
    createdAt: message['createdAt'] ?? null,
  };
  const sequence = message['sequence'];
  if (typeof sequence === 'number') item['sequence'] = sequence;
  if (includeToolCalls) {
    const toolCalls = readToolCalls(message);
    if (toolCalls.length > 0) {
      item['toolCalls'] = toolCalls.map((tc) => {
        const rec = tc as Record<string, unknown>;
        const args = rec['arguments'];
        const argsPreview =
          typeof args === 'string' && args.length > MAX_TOOL_ARGS_PREVIEW_CHARS
            ? args.slice(0, MAX_TOOL_ARGS_PREVIEW_CHARS) + '...'
            : args;
        return {
          id: rec['id'] ?? null,
          name: rec['name'] ?? null,
          arguments: argsPreview,
        };
      });
    }
  }
  return item;
}

function applyOffsetLimit<T>(
  items: readonly T[],
  offset: number,
  limit: number | undefined,
  fromEnd: boolean,
): T[] {
  const total = items.length;
  let start: number;
  let end: number;
  if (fromEnd) {
    const tailSize = typeof limit === 'number' ? limit : total;
    start = Math.max(0, total - tailSize);
    end = total;
  } else {
    start = Math.min(offset, total);
    end = typeof limit === 'number' ? Math.min(start + limit, total) : total;
  }
  return [...items.slice(start, end)];
}

export function createSessionsReadTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: sessionsReadMeta.name,
    description: sessionsReadMeta.description,
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to read.',
        },
        messageId: {
          type: 'string',
          description:
            'Fetch a single message by id with full content. When set, ' +
            'pagination and content-truncation params are ignored for that ' +
            'one message (always returns full content).',
        },
        limit: {
          type: 'number',
          description:
            'Max number of messages to return. Default: all (preserves ' +
            'backward-compatible behavior). Combine with fromEnd for a ' +
            'tail-only read.',
        },
        offset: {
          type: 'number',
          description:
            'Skip this many messages at the start of the slice. ' +
            'Default: 0.',
        },
        fromEnd: {
          type: 'boolean',
          description:
            'When true, take the slice from the END of the message list ' +
            '(useful with limit to read the last N messages cheaply). ' +
            'Default: false.',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description:
            'Chronological order of messages. Default: "asc" (oldest ' +
            'first). Use "desc" with fromEnd=true for a clean tail view.',
        },
        role: {
          type: 'string',
          enum: [...ROLE_VALUES],
          description: 'Filter messages by role. Default: no filter.',
        },
        includeRuns: {
          type: 'boolean',
          description:
            'Include runs in the response. Default: true. Set false to ' +
            'fetch only messages (cheaper).',
        },
        includeMessages: {
          type: 'boolean',
          description:
            'Include messages in the response. Default: true. Set false ' +
            'to fetch only runs (cheaper).',
        },
        includeToolCalls: {
          type: 'boolean',
          description:
            'Include a per-message toolCalls array (id, name, truncated ' +
            'arguments). Default: false — opt-in because tool-call ' +
            'arguments can be large.',
        },
        fullContent: {
          type: 'boolean',
          description:
            'Return full message content without the default 500-char ' +
            'truncation. Default: false. Applies to all returned ' +
            'messages, so pair with limit to keep output bounded.',
        },
      },
      required: ['sessionId'],
    },

    async execute(args, _ctx) {
      const sessionId = readStringArg(args, 'sessionId');
      const messageId = readStringArg(args, 'messageId');
      const limit = readNumberArg(args, 'limit');
      const offset = readNumberArg(args, 'offset') ?? 0;
      const fromEnd = readBooleanArg(args, 'fromEnd') ?? false;
      const order = readStringArg(args, 'order') ?? 'asc';
      const role = readStringArg(args, 'role');
      const includeRuns = readBooleanArg(args, 'includeRuns') ?? true;
      const includeMessages = readBooleanArg(args, 'includeMessages') ?? true;
      const includeToolCalls =
        readBooleanArg(args, 'includeToolCalls') ?? false;
      const fullContent = readBooleanArg(args, 'fullContent') ?? false;

      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return {
          ok: false,
          error: 'sessionId is required and must be a non-empty string',
        };
      }
      if (order !== 'asc' && order !== 'desc') {
        return {
          ok: false,
          error: `order must be "asc" or "desc", got "${order}"`,
        };
      }
      if (role !== undefined && !ROLE_VALUES.includes(role as never)) {
        return {
          ok: false,
          error: `role must be one of ${ROLE_VALUES.join(', ')}, got "${role}"`,
        };
      }
      if (typeof limit === 'number' && limit < 0) {
        return {
          ok: false,
          error: 'limit must be >= 0',
        };
      }
      if (offset < 0) {
        return {
          ok: false,
          error: 'offset must be >= 0',
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
        const allMessages = await sessionService.listMessages(sessionId.trim());
        const allRuns = await sessionService.listRuns(sessionId.trim());

        let messagesForOutput: unknown[];
        let totalMessages: number;
        let truncated = false;

        if (messageId !== undefined) {
          const found = allMessages.find((m) => {
            const r = m as Record<string, unknown>;
            return r['id'] === messageId;
          });
          if (!found) {
            return {
              ok: false,
              error: `Message "${messageId}" not found in session "${sessionId}".`,
            };
          }
          messagesForOutput = [
            buildMessageItem(
              found as Record<string, unknown>,
              true,
              includeToolCalls,
            ),
          ];
          totalMessages = allMessages.length;
          truncated = false;
        } else if (includeMessages) {
          const filtered =
            role === undefined
              ? allMessages
              : allMessages.filter((m) => {
                  const r = m as Record<string, unknown>;
                  return r['role'] === role;
                });
          totalMessages = filtered.length;
          const sliced = applyOffsetLimit(filtered, offset, limit, fromEnd);
          const ordered = order === 'desc' ? [...sliced].reverse() : sliced;
          messagesForOutput = ordered.map((m) =>
            buildMessageItem(
              m as Record<string, unknown>,
              fullContent,
              includeToolCalls,
            ),
          );
          truncated = sliced.length < filtered.length;
        } else {
          messagesForOutput = [];
          totalMessages = allMessages.length;
        }

        const runItems = includeRuns
          ? allRuns.map((r) => {
              const rec = r as Record<string, unknown>;
              return {
                id: rec['id'],
                agentId: rec['agentId'],
                status: rec['status'],
                finishReason: rec['finishReason'] ?? null,
                errorCode: rec['errorCode'] ?? null,
                errorMessage: rec['errorMessage'] ?? null,
                createdAt: rec['createdAt'] ?? null,
              };
            })
          : [];

        const result: Record<string, unknown> = {
          id: s['id'],
          title: s['title'],
          createdAt: s['createdAt'] ?? null,
          messageCount: allMessages.length,
          filteredMessageCount: totalMessages,
          ...(messageId === undefined &&
            typeof limit === 'number' && { limit }),
          ...(messageId === undefined && { offset }),
          ...(messageId === undefined && { fromEnd }),
          ...(messageId === undefined && { order }),
          ...(messageId === undefined && role !== undefined && { role }),
          ...(messageId === undefined && { truncated }),
          ...(includeMessages && { messages: messagesForOutput }),
          ...(includeRuns && {
            runCount: runItems.length,
            runs: runItems,
          }),
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
