import { nanoid } from 'nanoid';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
// Log Entry Types
// ============================================================================

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  args?: unknown[];
  requestId?: string;
  sessionId?: string;
  runId?: string;
};

export type LogFilter = {
  levels?: LogLevel[];
  contexts?: string[];
  since?: string;
  until?: string;
  search?: string;
  requestId?: string;
  sessionId?: string;
  runId?: string;
  limit?: number;
  offset?: number;
};

export type LogQueryResult = {
  items: LogEntry[];
  total: number;
  hasMore: boolean;
};

export type LogStats = {
  total: number;
  byLevel: Record<LogLevel, number>;
  byContext: Record<string, number>;
  timeRange: {
    earliest: string | null;
    latest: string | null;
  };
};

// ============================================================================
// Log Buffer
// ============================================================================

export type LogBufferOptions = {
  maxSize?: number;
};

export class LogBuffer {
  private entries: LogEntry[] = [];
  private maxSize: number;

  constructor(options?: LogBufferOptions) {
    this.maxSize = options?.maxSize ?? 10000;
  }

  add(entry: LogEntry): void {
    this.entries.push(entry);
    // Prune if over max size
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize);
    }
  }

  query(filter: LogFilter = {}): LogQueryResult {
    let filtered = [...this.entries];

    // Filter by levels
    if (filter.levels && filter.levels.length > 0) {
      const levelSet = new Set(filter.levels);
      filtered = filtered.filter((e) => levelSet.has(e.level));
    }

    // Filter by contexts
    if (filter.contexts && filter.contexts.length > 0) {
      const contextSet = new Set(filter.contexts);
      filtered = filtered.filter((e) => contextSet.has(e.context));
    }

    // Filter by time range
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= since);
    }
    if (filter.until) {
      const until = new Date(filter.until).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= until);
    }

    // Filter by search
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.message.toLowerCase().includes(searchLower) ||
          e.context.toLowerCase().includes(searchLower)
      );
    }

    // Filter by correlation IDs
    if (filter.requestId) {
      filtered = filtered.filter((e) => e.requestId === filter.requestId);
    }
    if (filter.sessionId) {
      filtered = filtered.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter.runId) {
      filtered = filtered.filter((e) => e.runId === filter.runId);
    }

    const total = filtered.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;

    const items = filtered.slice(offset, offset + limit);
    const hasMore = offset + items.length < total;

    return { items, total, hasMore };
  }

  getStats(): LogStats {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    const byContext: Record<string, number> = {};

    for (const entry of this.entries) {
      byLevel[entry.level]++;
      byContext[entry.context] = (byContext[entry.context] ?? 0) + 1;
    }

    const timeRange = {
      earliest: this.entries.length > 0 ? this.entries[0].timestamp : null,
      latest:
        this.entries.length > 0 ? this.entries[this.entries.length - 1].timestamp : null,
    };

    return {
      total: this.entries.length,
      byLevel,
      byContext,
      timeRange,
    };
  }

  clear(): void {
    this.entries = [];
  }

  // Get all entries (for testing)
  getAll(): LogEntry[] {
    return [...this.entries];
  }
}

// ============================================================================
// Global Buffer Instance
// ============================================================================

let globalBuffer: LogBuffer | null = null;

export function getLogBuffer(): LogBuffer {
  if (!globalBuffer) {
    globalBuffer = new LogBuffer();
  }
  return globalBuffer;
}

// For testing
export function resetLogBuffer(): void {
  globalBuffer = null;
}

// ============================================================================
// Logger Interface
// ============================================================================

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

// ============================================================================
// Correlation ID Context
// ============================================================================

type CorrelationContext = {
  requestId?: string;
  sessionId?: string;
  runId?: string;
};

let currentCorrelation: CorrelationContext = {};

export function setCorrelationContext(ctx: CorrelationContext): void {
  currentCorrelation = { ...ctx };
}

export function getCorrelationContext(): CorrelationContext {
  return { ...currentCorrelation };
}

export function clearCorrelationContext(): void {
  currentCorrelation = {};
}

// ============================================================================
// Create Logger
// ============================================================================

export function createLogger(context: string = ''): Logger {
  const buffer = getLogBuffer();

  const log = (level: LogLevel, message: string, ...args: unknown[]): void => {
    if (shouldLog(level)) {
      const entry: LogEntry = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        level,
        context,
        message,
        args: args.length > 0 ? args : undefined,
        ...currentCorrelation,
      };

      buffer.add(entry);
      // Use appropriate console method based on level
      const consoleFn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
      consoleFn(formatMessage(level, context, message), ...args);
    }
  };

  return {
    debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => log('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => log('error', message, ...args),
  };
}

// ============================================================================
// Exports
// ============================================================================

export const logger = createLogger();

// Backwards compatibility
export const loggerOptions = {
  level: currentLevel,
};
