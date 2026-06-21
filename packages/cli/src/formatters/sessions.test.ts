/**
 * Sessions Formatter Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatSessionList,
  formatSessionDetail,
  formatMessageList,
  formatRunList,
  formatEmptyState,
  formatRelativeDate,
  formatFullDate,
} from './sessions.js';
import type {
  SessionSummary,
  SessionDetail,
  SessionMessage,
  MessageRole,
} from '@openaidy/shared-types';
import type { SessionRun } from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'sess-001',
    title: 'Test Session',
    createdAt: new Date('2026-01-15T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'sess-001',
    title: 'Test Session',
    createdAt: new Date('2026-01-15T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-15T12:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg-001',
    sessionId: 'sess-001',
    role: 'user' as MessageRole,
    content: 'Hello, world!',
    sequence: 1,
    createdAt: new Date('2026-01-15T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<SessionRun> = {}): SessionRun {
  return {
    id: 'run-001',
    status: 'succeeded',
    providerId: 'openai',
    modelId: 'gpt-4o',
    durationMs: 1234,
    createdAt: new Date('2026-01-15T10:00:00Z').toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatSessionList
// ---------------------------------------------------------------------------

describe('formatSessionList', () => {
  it('returns empty state when list is empty', () => {
    const output = formatSessionList([]);
    expect(output).toContain('No sessions found');
    expect(output).toContain('openaidy sessions create');
  });

  it('formats a single session', () => {
    const output = formatSessionList([makeSession()]);
    expect(output).toContain('Test Session');
    expect(output).toContain('sess-001');
  });

  it('formats multiple sessions', () => {
    const sessions = [
      makeSession({ id: 'sess-1', title: 'Session One' }),
      makeSession({ id: 'sess-2', title: 'Session Two' }),
    ];
    const output = formatSessionList(sessions);
    expect(output).toContain('Session One');
    expect(output).toContain('Session Two');
    expect(output).toContain('sess-1');
    expect(output).toContain('sess-2');
  });

  it('shows created date in relative format', () => {
    const now = new Date();
    const output = formatSessionList([
      makeSession({ createdAt: now.toISOString() }),
    ]);
    expect(output).toContain('just now');
  });
});

// ---------------------------------------------------------------------------
// formatSessionDetail
// ---------------------------------------------------------------------------

describe('formatSessionDetail', () => {
  it('formats session with all fields', () => {
    const output = formatSessionDetail(makeDetail());
    expect(output).toContain('Test Session');
    expect(output).toContain('sess-001');
    expect(output).toContain('Created:');
    expect(output).toContain('Updated:');
  });

  it('omits updatedAt when not present', () => {
    const output = formatSessionDetail(makeDetail({ updatedAt: undefined }));
    expect(output).toContain('Created:');
    expect(output).not.toContain('Updated:');
  });

  it('formats title with underline', () => {
    const output = formatSessionDetail(makeDetail({ title: 'Hello' }));
    // Should have "Hello" then a line of === below it
    expect(output).toContain('Hello');
    expect(output).toContain('====');
  });
});

// ---------------------------------------------------------------------------
// formatMessageList
// ---------------------------------------------------------------------------

describe('formatMessageList', () => {
  it('returns empty state when no messages', () => {
    const output = formatMessageList([], 'Test Session');
    expect(output).toContain('No messages');
    expect(output).toContain('Test Session');
  });

  it('formats user message', () => {
    const msg = makeMessage({ role: 'user', content: 'Hi there' });
    const output = formatMessageList([msg], 'Test');
    expect(output).toContain('[User]');
    expect(output).toContain('Hi there');
  });

  it('formats assistant message', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Hello!' });
    const output = formatMessageList([msg], 'Test');
    expect(output).toContain('[Assistant]');
    expect(output).toContain('Hello!');
  });

  it('formats system message', () => {
    const msg = makeMessage({ role: 'system', content: 'System prompt' });
    const output = formatMessageList([msg], 'Test');
    expect(output).toContain('[System]');
    expect(output).toContain('System prompt');
  });

  it('truncates long messages at 200 chars', () => {
    const longContent = 'a'.repeat(300);
    const msg = makeMessage({ content: longContent });
    const output = formatMessageList([msg], 'Test');
    expect(output).not.toContain('aaaaa'); // truncated content
    expect(output).toContain('…');
  });
});

// ---------------------------------------------------------------------------
// formatRunList
// ---------------------------------------------------------------------------

describe('formatRunList', () => {
  it('returns empty state when no runs', () => {
    const output = formatRunList([], 'Test Session');
    expect(output).toContain('No runs');
    expect(output).toContain('Test Session');
  });

  it('shows check icon for succeeded run', () => {
    const run = makeRun({ status: 'succeeded' });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('✓');
    expect(output).toContain('succeeded');
  });

  it('shows X icon for failed run', () => {
    const run = makeRun({ status: 'failed' });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('✗');
    expect(output).toContain('failed');
  });

  it('shows ellipsis for running run', () => {
    const run = makeRun({ status: 'running' });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('…');
  });

  it('shows circle for queued run', () => {
    const run = makeRun({ status: 'queued' });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('○');
  });

  it('shows provider and model when present', () => {
    const run = makeRun({ providerId: 'anthropic', modelId: 'claude-3-opus' });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('anthropic');
    expect(output).toContain('claude-3-opus');
  });

  it('shows duration when present', () => {
    const run = makeRun({ durationMs: 5000 });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('5000ms');
  });

  it('omits optional fields when not present', () => {
    const run = makeRun({
      providerId: undefined,
      modelId: undefined,
      durationMs: undefined,
    });
    const output = formatRunList([run], 'Test');
    expect(output).toContain('run-001');
    expect(output).not.toContain('Provider:');
    expect(output).not.toContain('Model:');
  });
});

// ---------------------------------------------------------------------------
// formatEmptyState
// ---------------------------------------------------------------------------

describe('formatEmptyState', () => {
  it('returns empty state with create hint', () => {
    const output = formatEmptyState();
    expect(output).toContain('No sessions found');
    expect(output).toContain('openaidy sessions create');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeDate
// ---------------------------------------------------------------------------

describe('formatRelativeDate', () => {
  it('returns "just now" for very recent dates', () => {
    const now = new Date();
    expect(formatRelativeDate(now.toISOString())).toBe('just now');
  });

  it('returns minutes for dates within an hour', () => {
    const ago = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeDate(ago.toISOString())).toBe('5m ago');
  });

  it('returns hours for dates within a day', () => {
    const ago = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeDate(ago.toISOString())).toBe('3h ago');
  });

  it('returns days for dates within a week', () => {
    const ago = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeDate(ago.toISOString())).toBe('2d ago');
  });

  it('returns locale date for older dates', () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const output = formatRelativeDate(old.toISOString());
    // Should be a locale date string, not "Xd ago"
    expect(output).not.toMatch(/m ago|h ago|d ago/);
  });
});

// ---------------------------------------------------------------------------
// formatFullDate
// ---------------------------------------------------------------------------

describe('formatFullDate', () => {
  it('formats date with time', () => {
    const output = formatFullDate('2026-01-15T10:30:00Z');
    expect(output).toContain('2026');
    expect(output).toContain('Jan');
    expect(output).toContain('15');
  });
});
