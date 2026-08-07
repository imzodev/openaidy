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
