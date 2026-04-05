import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LogBuffer,
  getLogBuffer,
  resetLogBuffer,
  createLogger,
  setCorrelationContext,
  clearCorrelationContext,
  type LogEntry,
  type LogFilter,
} from './logger';

describe('LogBuffer', () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer({ maxSize: 100 });
  });

  describe('add', () => {
    it('should add entries to the buffer', () => {
      const entry: LogEntry = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        level: 'info',
        context: 'test',
        message: 'Test message',
      };

      buffer.add(entry);
      const result = buffer.query();

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(entry);
    });

    it('should prune entries when exceeding max size', () => {
      const smallBuffer = new LogBuffer({ maxSize: 5 });

      for (let i = 0; i < 10; i++) {
        smallBuffer.add({
          id: `test-${i}`,
          timestamp: new Date().toISOString(),
          level: 'info',
          context: 'test',
          message: `Message ${i}`,
        });
      }

      const result = smallBuffer.query();
      expect(result.items).toHaveLength(5);
      expect(result.items[0].message).toBe('Message 5');
      expect(result.items[4].message).toBe('Message 9');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      const entries: LogEntry[] = [
        { id: '1', timestamp: '2024-01-01T10:00:00Z', level: 'debug', context: 'app', message: 'Debug msg' },
        { id: '2', timestamp: '2024-01-01T11:00:00Z', level: 'info', context: 'app', message: 'Info msg' },
        { id: '3', timestamp: '2024-01-01T12:00:00Z', level: 'warn', context: 'api', message: 'Warn msg' },
        { id: '4', timestamp: '2024-01-01T13:00:00Z', level: 'error', context: 'api', message: 'Error msg' },
        { id: '5', timestamp: '2024-01-01T14:00:00Z', level: 'info', context: 'db', message: 'DB info' },
      ];

      entries.forEach((e) => buffer.add(e));
    });

    it('should return all entries with no filter', () => {
      const result = buffer.query();
      expect(result.items).toHaveLength(5);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by levels', () => {
      const result = buffer.query({ levels: ['error', 'warn'] });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.level === 'error' || e.level === 'warn')).toBe(true);
    });

    it('should filter by contexts', () => {
      const result = buffer.query({ contexts: ['api'] });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.context === 'api')).toBe(true);
    });

    it('should filter by time range (since)', () => {
      const result = buffer.query({ since: '2024-01-01T12:00:00Z' });
      expect(result.items).toHaveLength(3);
    });

    it('should filter by time range (until)', () => {
      const result = buffer.query({ until: '2024-01-01T12:00:00Z' });
      expect(result.items).toHaveLength(3);
    });

    it('should filter by search term', () => {
      const result = buffer.query({ search: 'error' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].message).toBe('Error msg');
    });

    it('should search in context as well', () => {
      const result = buffer.query({ search: 'api' });
      expect(result.items).toHaveLength(2);
    });

    it('should filter by correlation IDs', () => {
      buffer.add({
        id: '6',
        timestamp: '2024-01-01T15:00:00Z',
        level: 'info',
        context: 'test',
        message: 'With session',
        sessionId: 'session-123',
      });

      const result = buffer.query({ sessionId: 'session-123' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].sessionId).toBe('session-123');
    });

    it('should support pagination', () => {
      const result1 = buffer.query({ limit: 2, offset: 0 });
      expect(result1.items).toHaveLength(2);
      expect(result1.hasMore).toBe(true);

      const result2 = buffer.query({ limit: 2, offset: 2 });
      expect(result2.items).toHaveLength(2);
      expect(result2.hasMore).toBe(true);

      const result3 = buffer.query({ limit: 2, offset: 4 });
      expect(result3.items).toHaveLength(1);
      expect(result3.hasMore).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      const entries: LogEntry[] = [
        { id: '1', timestamp: '2024-01-01T10:00:00Z', level: 'debug', context: 'app', message: 'Debug' },
        { id: '2', timestamp: '2024-01-01T11:00:00Z', level: 'info', context: 'app', message: 'Info 1' },
        { id: '3', timestamp: '2024-01-01T12:00:00Z', level: 'info', context: 'api', message: 'Info 2' },
        { id: '4', timestamp: '2024-01-01T13:00:00Z', level: 'error', context: 'api', message: 'Error' },
      ];

      entries.forEach((e) => buffer.add(e));
    });

    it('should return correct stats', () => {
      const stats = buffer.getStats();

      expect(stats.total).toBe(4);
      expect(stats.byLevel).toEqual({
        debug: 1,
        info: 2,
        warn: 0,
        error: 1,
      });
      expect(stats.byContext).toEqual({
        app: 2,
        api: 2,
      });
      expect(stats.timeRange.earliest).toBe('2024-01-01T10:00:00Z');
      expect(stats.timeRange.latest).toBe('2024-01-01T13:00:00Z');
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      buffer.add({
        id: '1',
        timestamp: new Date().toISOString(),
        level: 'info',
        context: 'test',
        message: 'Test',
      });

      buffer.clear();
      const result = buffer.query();

      expect(result.items).toHaveLength(0);
    });
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    resetLogBuffer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log to console and buffer', () => {
    const log = createLogger('test');
    log.info('Hello world');

    const buffer = getLogBuffer();
    const result = buffer.query();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].context).toBe('test');
    expect(result.items[0].message).toBe('Hello world');
    expect(result.items[0].level).toBe('info');
  });

  it('should include correlation context', () => {
    setCorrelationContext({ sessionId: 'session-123', runId: 'run-456' });

    const log = createLogger('test');
    log.info('With correlation');

    const buffer = getLogBuffer();
    const result = buffer.query();

    expect(result.items[0].sessionId).toBe('session-123');
    expect(result.items[0].runId).toBe('run-456');

    clearCorrelationContext();
  });
});

describe('getLogBuffer', () => {
  beforeEach(() => {
    resetLogBuffer();
  });

  it('should return a singleton buffer', () => {
    const buffer1 = getLogBuffer();
    const buffer2 = getLogBuffer();

    expect(buffer1).toBe(buffer2);
  });
});
