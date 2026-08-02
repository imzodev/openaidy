import { nanoid } from 'nanoid';
import { Writable } from 'node:stream';
import type { LogLevel, LogEntry } from '@openaidy/shared-types';
import { getLogBuffer } from './log-buffer';
import { getCorrelationContext } from './correlation';

export { LogBuffer, getLogBuffer, resetLogBuffer } from './log-buffer';
export {
  setCorrelationContext,
  getCorrelationContext,
  clearCorrelationContext,
} from './correlation';

// ============================================================================
// Logger Interface
// ============================================================================

interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

type LogFn = (message: string, ...args: unknown[]) => void;

/**
 * A log function that accepts either this module's `(message, ...args)` order
 * or pino's `(mergeObject, message)` order. See {@link toPinoStyleLogger}.
 */
type PinoStyleLogFn = {
  (message: string, ...args: unknown[]): void;
  (context: object, message?: string, ...args: unknown[]): void;
};

export interface PinoStyleLogger {
  debug: PinoStyleLogFn;
  info: PinoStyleLogFn;
  warn: PinoStyleLogFn;
  error: PinoStyleLogFn;
}

// ============================================================================
// Internal helpers
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const currentLevelValue = LOG_LEVELS[currentLevel] ?? 1;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevelValue;
}

function formatMessage(
  level: LogLevel,
  context: string,
  message: string,
): string {
  const timestamp = new Date().toISOString();
  const ctx = context ? `[${context}]` : '';
  return `${timestamp} [${level.toUpperCase()}]${ctx} ${message}`;
}

// ============================================================================
// createLogger
// ============================================================================

export function createLogger(context: string = ''): Logger {
  const buffer = getLogBuffer();

  const log = (level: LogLevel, message: string, ...args: unknown[]): void => {
    if (shouldLog(level)) {
      const correlation = getCorrelationContext();
      const entry: LogEntry = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        level,
        context,
        message,
        args: args.length > 0 ? args : undefined,
        ...correlation,
      };
      buffer.add(entry);
      const consoleFn =
        level === 'warn'
          ? console.warn
          : level === 'error'
            ? console.error
            : console.log;
      consoleFn(formatMessage(level, context, message), ...args);
    }
  };

  return {
    debug: (message, ...args) => log('debug', message, ...args),
    info: (message, ...args) => log('info', message, ...args),
    warn: (message, ...args) => log('warn', message, ...args),
    error: (message, ...args) => log('error', message, ...args),
  };
}

export const logger = createLogger();

/**
 * Wrap a {@link Logger} so it also accepts pino's `(mergeObject, message)`
 * calling convention.
 *
 * Services typed against Fastify's `FastifyBaseLogger` — the MCP client, the
 * scheduler, the channels, `SessionMessageService` — log structured context
 * first: `logger.warn({ serverId, stderr }, 'MCP server stderr')`. Handing them
 * this module's `(message, ...args)` logger made the context object the
 * *message*, so every such line printed `[object Object]` and the real text was
 * demoted to an argument. The context itself (an MCP server's stderr, a job id,
 * a provider error) reached neither the console nor the log buffer's `message`
 * field, which is how a failing MCP server's Python traceback stayed invisible.
 *
 * Both orders are accepted, so a consumer that logs `(message, meta)` is
 * unaffected.
 */
export function toPinoStyleLogger(base: Logger): PinoStyleLogger {
  const adapt =
    (fn: LogFn): PinoStyleLogFn =>
    (first: string | object, ...rest: unknown[]) => {
      // Already `(message, ...args)` — pass through untouched.
      if (typeof first === 'string') {
        fn(first, ...rest);
        return;
      }
      // pino order: the message (when present) follows the merge object.
      const [message, ...others] = rest;
      const text = typeof message === 'string' ? message : '';
      fn(text, first, ...others);
    };

  return {
    debug: adapt(base.debug),
    info: adapt(base.info),
    warn: adapt(base.warn),
    error: adapt(base.error),
  };
}

// ============================================================================
// Fastify HTTP Logging Plugin
// ============================================================================

import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Registers HTTP request/response logging hooks on a Fastify app.
 * Uses the singleton logger to log all HTTP requests (except /logs endpoints).
 */
export function registerHttpLogger(app: {
  addHook: (
    hook: 'onRequest' | 'onResponse',
    fn: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>,
  ) => void;
}): void {
  app.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
    logger.debug(`→ ${request.method} ${request.url}`);
  });
  app.addHook('onResponse', async (request, reply) => {
    // Skip logging for log query endpoints to avoid noise
    if (request.url.startsWith('/logs')) return;
    if (!reply) return;
    const duration = Date.now() - (request.startTime ?? Date.now());
    const level = reply.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      `← ${request.method} ${request.url} ${reply.statusCode} ${duration}ms`,
    );
  });
}

const PINO_TO_LEVEL: Record<number, LogLevel> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

function createPinoBufferStream(): Writable {
  const buffer = getLogBuffer();
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      try {
        const line = chunk.toString().trim();
        if (!line) return callback();
        const obj = JSON.parse(line) as Record<string, unknown>;
        const levelNum = typeof obj.level === 'number' ? obj.level : 30;
        const level: LogLevel = PINO_TO_LEVEL[levelNum] ?? 'info';

        // Extract request info from Fastify's serialized req/res
        const req = obj.req as
          | { method?: string; path?: string; url?: string }
          | undefined;
        const _res = obj.res as { statusCode?: number } | undefined;

        // Build message with route info for incoming/request completed
        let msg = typeof obj.msg === 'string' ? obj.msg : JSON.stringify(obj);
        if (
          (msg === 'incoming request' || msg === 'request completed') &&
          req
        ) {
          msg = `${msg}: ${req.method} ${req.path ?? req.url}`;
        }

        const context =
          typeof obj.context === 'string'
            ? obj.context
            : typeof obj.name === 'string'
              ? obj.name
              : 'server';
        const entry: LogEntry = {
          id: nanoid(),
          timestamp:
            typeof obj.time === 'number'
              ? new Date(obj.time).toISOString()
              : new Date().toISOString(),
          level,
          context,
          message: msg,
          sessionId:
            typeof obj.sessionId === 'string' ? obj.sessionId : undefined,
          requestId:
            typeof obj.requestId === 'string' ? obj.requestId : undefined,
          runId: typeof obj.runId === 'string' ? obj.runId : undefined,
        };
        buffer.add(entry);
      } catch {
        // Ignore unparseable lines (e.g. plain-text startup banners)
      }
      callback();
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loggerOptions: any = {
  level: currentLevel,
  stream: createPinoBufferStream(),
  serializers: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req(request: any) {
      return {
        method: request.method,
        url: request.url,
        path: request.routerPath ?? request.url.split('?')[0],
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res(response: any) {
      return {
        statusCode: response.statusCode,
      };
    },
  },
};
