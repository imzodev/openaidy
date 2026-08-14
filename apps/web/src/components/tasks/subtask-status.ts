/**
 * Shared subtask status display constants — used by both SubtaskList
 * (the plain list view) and the workflow canvas (WorkflowNode), so the
 * two views always agree on how a status looks.
 */

export const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  assigned: '●',
  in_progress: '▶',
  completed: '✓',
  failed: '✗',
};

export const STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400',
  assigned: 'text-blue-400',
  in_progress: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
};

/** Tinted circular-badge background for a status icon (workflow canvas node
 * header, property panel). Deliberately separate from STATUS_COLORS (plain
 * icon tint, used by SubtaskList too) since a badge needs both a bg and a
 * matching foreground shade. */
export const STATUS_BADGE_BG: Record<string, string> = {
  pending: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  assigned: 'bg-blue-200 text-blue-700 dark:bg-blue-800 dark:text-blue-300',
  in_progress:
    'bg-yellow-200 text-yellow-700 dark:bg-yellow-800 dark:text-yellow-300',
  completed:
    'bg-green-200 text-green-700 dark:bg-green-800 dark:text-green-300',
  failed: 'bg-red-200 text-red-700 dark:bg-red-800 dark:text-red-300',
};
