/**
 * Sessions Formatters
 *
 * Shared formatting logic for sessions CLI output.
 * Reusable across all sessions commands (list, get, messages, runs).
 */

import type { SessionSummary, SessionDetail } from '@openaidy/shared-types';
import type { SessionRun } from '../types.js';

/**
 * Message summary returned by GET /sessions/:id/messages API.
 * Does not include sessionId/sequence as those are derived from context.
 */
export type SessionMessageSummary = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

/**
 * Format a list of sessions for display
 */
export function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return 'No sessions found.\n\nCreate one with: openaidy sessions create';
  }

  const lines: string[] = [];
  for (const session of sessions) {
    const date = formatRelativeDate(session.createdAt);
    lines.push(`  ${session.title}`);
    lines.push(`    ID:      ${session.id}`);
    lines.push(`    Created: ${date}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format a single session for display
 */
export function formatSessionDetail(session: SessionDetail): string {
  const lines: string[] = [];
  lines.push(session.title);
  lines.push('========' + '='.repeat(session.title.length));
  lines.push(`ID:        ${session.id}`);
  lines.push(`Created:   ${formatFullDate(session.createdAt)}`);
  if (session.updatedAt) {
    lines.push(`Updated:   ${formatFullDate(session.updatedAt)}`);
  }
  return lines.join('\n');
}

/**
 * Format session messages for display
 */
export function formatMessageList(
  messages: SessionMessageSummary[],
  sessionTitle: string,
): string {
  if (messages.length === 0) {
    return `No messages in session "${sessionTitle}".`;
  }

  const lines: string[] = [
    `Messages in "${sessionTitle}"`,
    '===========================',
    '',
  ];
  for (const msg of messages) {
    const role = formatRole(msg.role);
    lines.push(`[${role}] ${formatRelativeDate(msg.createdAt)}`);
    // Truncate long messages
    const content =
      msg.content.length > 200 ? msg.content.slice(0, 200) + '…' : msg.content;
    lines.push(`  ${content}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format session runs for display
 */
export function formatRunList(
  runs: SessionRun[],
  sessionTitle: string,
): string {
  if (runs.length === 0) {
    return `No runs in session "${sessionTitle}".`;
  }

  const lines: string[] = [
    `Runs in "${sessionTitle}"`,
    '======================',
    '',
  ];
  for (const run of runs) {
    const icon =
      run.status === 'succeeded'
        ? '✓'
        : run.status === 'failed'
          ? '✗'
          : run.status === 'running'
            ? '…'
            : '○';
    lines.push(`  ${icon} ${run.id}`);
    lines.push(`    Status:   ${run.status}`);
    if (run.providerId) lines.push(`    Provider: ${run.providerId}`);
    if (run.modelId) lines.push(`    Model:    ${run.modelId}`);
    if (run.durationMs) lines.push(`    Duration: ${run.durationMs}ms`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format an empty state for sessions
 */
export function formatEmptyState(): string {
  return 'No sessions found.\n\nCreate one with: openaidy sessions create';
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Role label helper
// ---------------------------------------------------------------------------

function formatRole(role: string): string {
  switch (role) {
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'user':
      return 'User';
    case 'tool':
      return 'Tool';
    default:
      return role;
  }
}
