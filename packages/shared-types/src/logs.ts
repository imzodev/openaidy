/**
 * Shared log types used by both server and web clients
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  args?: unknown[] | undefined;
  requestId?: string | undefined;
  sessionId?: string | undefined;
  runId?: string | undefined;
};

export type LogFilter = {
  levels?: LogLevel[] | undefined;
  contexts?: string[] | undefined;
  since?: string | undefined;
  until?: string | undefined;
  search?: string | undefined;
  requestId?: string | undefined;
  sessionId?: string | undefined;
  runId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
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
    earliest: string | null | undefined;
    latest: string | null | undefined;
  };
};
