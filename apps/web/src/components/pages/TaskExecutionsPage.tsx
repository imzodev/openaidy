/**
 * TaskExecutionsPage Component
 *
 * Paginated execution history for a task schedule. Reachable from
 * the Schedule tab "View execution history" link.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import { listTaskExecutions, getTaskSchedule } from '../../lib/api-tasks';
import type {
  TaskExecutionHistoryStatus,
  ExecutionSubtaskSummary,
} from '../../lib/types';
import { ScheduleDisplay } from '../common/ScheduleDisplay';
import { ArrowLeft, AlertCircle, ExternalLink } from 'lucide-solid';

const STATUS_COLORS: Record<TaskExecutionHistoryStatus, string> = {
  planned: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  planning: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  executing:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300',
  verifying:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  completed:
    'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

export type TaskExecutionsPageProps = {
  taskId: string;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
};

const PAGE_SIZE = 20;

export function TaskExecutionsPage(props: TaskExecutionsPageProps) {
  const [page, setPage] = createSignal(0);
  const [statusFilter, setStatusFilter] = createSignal<
    TaskExecutionHistoryStatus | undefined
  >(undefined);

  const [schedule] = createResource(
    () => props.taskId,
    async (id) => {
      try {
        return await getTaskSchedule(id);
      } catch {
        return null;
      }
    },
  );

  const [data, { refetch }] = createResource(
    () => ({
      taskId: props.taskId,
      page: page(),
      status: statusFilter(),
    }),
    async ({ taskId, page, status }) => {
      return listTaskExecutions(taskId, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(status ? { status } : {}),
      });
    },
  );

  const totalPages = () =>
    Math.max(1, Math.ceil((data()?.total ?? 0) / PAGE_SIZE));

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    refetch();
  };

  const handleStatusFilter = (
    status: TaskExecutionHistoryStatus | undefined,
  ) => {
    setStatusFilter(status);
    setPage(0);
    refetch();
  };

  return (
    <div class="flex-1 flex flex-col p-6 overflow-auto">
      {/* Header */}
      <div class="mb-6">
        <button
          type="button"
          onClick={props.onBack}
          class="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline mb-3"
        >
          <ArrowLeft class="w-4 h-4" />
          Back to tasks
        </button>
        <h1 class="text-xl font-bold text-gray-900 dark:text-gray-100">
          Execution History
        </h1>
        <Show when={schedule()}>
          {(s) => (
            <div class="mt-1">
              <ScheduleDisplay schedule={s()} size="md" showStatus />
            </div>
          )}
        </Show>
      </div>

      {/* Status filter */}
      <div class="mb-4">
        <select
          value={statusFilter() ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            handleStatusFilter(
              v ? (v as TaskExecutionHistoryStatus) : undefined,
            );
          }}
          class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
        >
          <option value="">All statuses</option>
          <option value="planned">Planned</option>
          <option value="planning">Planning</option>
          <option value="executing">Executing</option>
          <option value="verifying">Verifying</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <Show
        when={!data.loading && (data()?.items.length ?? 0) > 0}
        fallback={
          <Show when={!data.loading}>
            <div class="flex flex-col items-center gap-3 py-12 text-center">
              <AlertCircle class="w-10 h-10 text-gray-300 dark:text-gray-600" />
              <p class="text-sm text-gray-500 dark:text-gray-400">
                No execution history found
                {statusFilter() ? ' for this status filter' : ''}.
              </p>
            </div>
          </Show>
        }
      >
        <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Status
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Started
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Finished
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Duration
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Run #
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Subtasks
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Session
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                  Error
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <For each={data()?.items ?? []}>
                {(ex) => (
                  <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td class="px-4 py-3">
                      <span
                        class={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[ex.status]}`}
                      >
                        {ex.status}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {new Date(ex.startedAt).toLocaleString()}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {ex.finishedAt
                        ? new Date(ex.finishedAt).toLocaleString()
                        : '-'}
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {ex.durationMs != null
                        ? `${(ex.durationMs / 1000).toFixed(1)}s`
                        : '-'}
                    </td>
                    <td class="px-4 py-3 text-gray-500 dark:text-gray-500 font-mono">
                      #{ex.attemptNumber}
                    </td>
                    <td class="px-4 py-3">
                      <Show
                        when={ex.subtaskSummary}
                        fallback={
                          <span class="text-gray-400 dark:text-gray-600 text-xs">
                            —
                          </span>
                        }
                      >
                        {(summary) => (
                          <SubtaskBadge
                            summary={summary()}
                            onOpenSession={props.onOpenSession}
                          />
                        )}
                      </Show>
                    </td>
                    <td class="px-4 py-3">
                      <Show
                        when={ex.sessionId}
                        fallback={
                          <span class="text-gray-400 dark:text-gray-600 text-xs">
                            —
                          </span>
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            ex.sessionId && props.onOpenSession?.(ex.sessionId)
                          }
                          class="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs"
                          title="View session"
                        >
                          <ExternalLink class="w-3.5 h-3.5" />
                          View
                        </button>
                      </Show>
                    </td>
                    <td class="px-4 py-3">
                      <Show when={ex.errorMessage}>
                        <span
                          class="text-red-500 dark:text-red-400 text-xs"
                          title={ex.errorMessage ?? undefined}
                        >
                          {ex.errorCode ?? 'Error'}
                        </span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div class="flex items-center justify-between mt-4 text-sm text-gray-600 dark:text-gray-400">
          <span>
            Showing {page() * PAGE_SIZE + 1}–
            {Math.min((page() + 1) * PAGE_SIZE, data()?.total ?? 0)} of{' '}
            {data()?.total ?? 0} executions
          </span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              disabled={page() === 0}
              onClick={() => handlePageChange(page() - 1)}
              class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span class="text-xs">
              Page {page() + 1} of {totalPages()}
            </span>
            <button
              type="button"
              disabled={page() >= totalPages() - 1}
              onClick={() => handlePageChange(page() + 1)}
              class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </Show>

      {/* Loading */}
      <Show when={data.loading}>
        <div class="flex justify-center py-12">
          <div class="text-gray-500 dark:text-gray-400">
            Loading executions...
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * SubtaskBadge — compact subtask status summary for an execution row.
 *
 * Shows a badge like "3✓ 1✗" (completed/failed out of total) and an
 * expandable list of each subtask with its status and a link to its
 * session (if the subtask has one).
 */
function SubtaskBadge(props: {
  summary: ExecutionSubtaskSummary;
  onOpenSession?: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const s = props.summary;

  const badgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300';
      case 'failed':
        return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300';
      default:
        return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
    }
  };

  return (
    <div class="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded())}
        class="inline-flex items-center gap-1.5 text-xs hover:underline"
        title="Click to toggle subtask details"
      >
        <span class="text-gray-600 dark:text-gray-400">
          {s.completed}/{s.total} done
        </span>
        <Show when={s.failed > 0}>
          <span class="text-red-500 dark:text-red-400">{s.failed} failed</span>
        </Show>
        <Show when={s.inProgress > 0}>
          <span class="text-yellow-600 dark:text-yellow-400">
            {s.inProgress} running
          </span>
        </Show>
        <span class="text-gray-400 dark:text-gray-600">
          {expanded() ? '▾' : '▸'}
        </span>
      </button>
      <Show when={expanded()}>
        <div class="space-y-1 pl-2 border-l border-gray-200 dark:border-gray-700">
          <For each={s.items}>
            {(item) => (
              <div class="flex items-center gap-2 text-xs">
                <span
                  class={`px-1.5 py-0.5 rounded ${badgeClass(item.status)}`}
                >
                  {item.status}
                </span>
                <span class="text-gray-600 dark:text-gray-400 truncate max-w-[200px]">
                  {item.title}
                </span>
                <Show when={item.sessionId}>
                  <button
                    type="button"
                    onClick={() =>
                      item.sessionId && props.onOpenSession?.(item.sessionId)
                    }
                    class="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                    title="View subtask session"
                  >
                    <ExternalLink class="w-3 h-3" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
