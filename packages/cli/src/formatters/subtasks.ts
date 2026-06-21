/**
 * Subtask List Formatter
 *
 * Formats subtask data for CLI output.
 */

import type { SubtaskStatus, SubtaskSummary, SubtaskWithDetails } from '@openaidy/shared-types';

/**
 * Map subtask status to a readable label
 */
export function formatSubtaskStatus(status: SubtaskStatus): string {
  const labels: Record<SubtaskStatus, string> = {
    pending:    'Pending',
    assigned:    'Assigned',
    in_progress:'In Progress',
    completed:  'Completed',
    failed:     'Failed',
  };
  return labels[status] ?? status;
}

/**
 * Format a full date string
 */
export function formatFullDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Truncate a string to maxLen characters, appending "…" if truncated
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

const RESULT_PREVIEW_MAX = 80;

/**
 * Format a single subtask summary line for list output
 */
export function formatSubtaskLine(subtask: SubtaskSummary): string {
  return `[${formatSubtaskStatus(subtask.status)}] ${subtask.title}`;
}

/**
 * Format a subtask detail block (for `subtasks get` — future)
 */
export function formatSubtaskDetail(subtask: SubtaskWithDetails): string {
  const lines: string[] = [];
  lines.push(`ID:           ${subtask.id}`);
  lines.push(`Task:         ${subtask.taskId}`);
  lines.push(`Title:        ${subtask.title}`);
  lines.push(`Description: ${subtask.description}`);
  lines.push(`Status:      ${formatSubtaskStatus(subtask.status)}`);
  if (subtask.assignedAgentId) {
    lines.push(`Assigned:    ${subtask.assignedAgentId}`);
  }
  if (subtask.result) {
    lines.push(`Result:      ${truncate(subtask.result, RESULT_PREVIEW_MAX)}`);
  }
  if (subtask.retryCount > 0) {
    lines.push(`Retries:     ${subtask.retryCount}`);
  }
  lines.push(`Created:     ${formatFullDate(subtask.createdAt)}`);
  lines.push(`Updated:     ${formatFullDate(subtask.updatedAt)}`);
  return lines.join('\n');
}

/**
 * Format a list of subtasks (for `subtasks list`)
 */
export function formatSubtaskList(subtasks: SubtaskSummary[]): string {
  if (subtasks.length === 0) return 'No subtasks found.';

  const lines: string[] = ['Subtasks', '========', ''];
  for (const s of subtasks) {
    lines.push(`[${formatSubtaskStatus(s.status)}] ${s.title}`);
    lines.push(`  ID:        ${s.id}`);
    lines.push(`  Task:      ${s.taskId}`);
    if (s.assignedAgentId) lines.push(`  Assigned:  ${s.assignedAgentId}`);
    if (s.result) lines.push(`  Result:    ${truncate(s.result, RESULT_PREVIEW_MAX)}`);
    if (s.retryCount > 0) lines.push(`  Retries:   ${s.retryCount}`);
    lines.push(`  Created:   ${formatFullDate(s.createdAt)}`);
    lines.push('');
  }
  return lines.join('\n');
}