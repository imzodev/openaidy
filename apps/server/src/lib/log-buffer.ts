import type {
  LogLevel,
  LogEntry,
  LogFilter,
  LogQueryResult,
  LogStats,
} from '@openaidy/shared-types';

export type LogBufferOptions = {
  maxSize?: number;
  onEntryAdded?: (entry: LogEntry) => void;
};

export class LogBuffer {
  private entries: LogEntry[] = [];
  private maxSize: number;
  private onEntryAdded?: (entry: LogEntry) => void;

  constructor(options?: LogBufferOptions) {
    this.maxSize = options?.maxSize ?? 10000;
    this.onEntryAdded = options?.onEntryAdded ?? (() => {});
  }

  setOnEntryAdded(callback: (entry: LogEntry) => void): void {
    this.onEntryAdded = callback;
  }

  add(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize);
    }
    if (this.onEntryAdded) {
      this.onEntryAdded(entry);
    }
  }

  query(filter: LogFilter = {}): LogQueryResult {
    let filtered = [...this.entries];

    if (filter.levels && filter.levels.length > 0) {
      const levelSet = new Set(filter.levels);
      filtered = filtered.filter((e) => levelSet.has(e.level));
    }
    if (filter.contexts && filter.contexts.length > 0) {
      const contextSet = new Set(filter.contexts);
      filtered = filtered.filter((e) => contextSet.has(e.context));
    }
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      filtered = filtered.filter(
        (e) => new Date(e.timestamp).getTime() >= since,
      );
    }
    if (filter.until) {
      const until = new Date(filter.until).getTime();
      filtered = filtered.filter(
        (e) => new Date(e.timestamp).getTime() <= until,
      );
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.message.toLowerCase().includes(searchLower) ||
          e.context.toLowerCase().includes(searchLower),
      );
    }
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

    const firstEntry = this.entries[0];
    const lastEntry = this.entries[this.entries.length - 1];

    return {
      total: this.entries.length,
      byLevel,
      byContext,
      timeRange: {
        earliest: firstEntry?.timestamp ?? null,
        latest: lastEntry?.timestamp ?? null,
      },
    };
  }

  clear(): void {
    this.entries = [];
  }

  getAll(): LogEntry[] {
    return [...this.entries];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalBuffer: LogBuffer | null = null;

export function getLogBuffer(): LogBuffer {
  if (!globalBuffer) {
    globalBuffer = new LogBuffer();
  }
  return globalBuffer;
}

export function resetLogBuffer(): void {
  globalBuffer = null;
}
