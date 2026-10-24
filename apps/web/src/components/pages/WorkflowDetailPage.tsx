/**
 * Workflow Detail Page
 *
 * A purpose-built full-page authoring surface for a single workflow (a
 * task with planning mode enabled) — not a repurposed modal. The graph
 * canvas (WorkflowEditor, which already fills whatever height/width its
 * container gives it) takes the entire viewport below a slim header bar
 * for identity/status/run/delete. No card chrome, no fixed-height box.
 *
 * The page stays live: the server's `workflow.updated` events refresh the
 * run status, the canvas and the runs panel (with polling only while the
 * WebSocket is down), and approval steps waiting on the user get a banner.
 */

import {
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  For,
  Show,
} from 'solid-js';
import {
  AlertTriangle,
  ArrowLeft,
  Play,
  Square,
  Trash2,
  Pencil,
  Workflow,
  History,
  Hourglass,
  Check,
  X,
  Loader2,
} from 'lucide-solid';
import type { WorkflowGraphCheck } from '@openaidy/workflow-templates';
import { WorkflowEditor } from '../tasks/workflow/WorkflowEditor';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  executeTask,
  checkWorkflow,
  cancelWorkflowRun,
  listWorkflowRuns,
  resolveApproval,
  type TaskWithDetails,
  type TaskStatus,
} from '../../lib/api-tasks';
import { listAgents, type Agent } from '../../lib/api';
import type { WorkflowRunDto } from '../../lib/types';
import { useWebSocketContext } from '../../lib/ws-provider';
import {
  onWorkflowUpdated,
  debounced,
  usePendingApprovals,
  refreshPendingApprovals,
} from '../../lib/workflow-live';
import {
  WorkflowRunsPanel,
  RUN_STATUS_LABEL,
  formatDuration,
} from '../workflows/WorkflowRunsPanel';

export type WorkflowDetailPageProps = {
  taskId: string;
  onBack: () => void;
};

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  todo: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  review:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const RUN_PILL: Record<WorkflowRunDto['status'], string> = {
  running:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  completed:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export function WorkflowDetailPage(props: WorkflowDetailPageProps) {
  const ws = useWebSocketContext();
  const [task, setTask] = createSignal<TaskWithDetails | null>(null);
  const [runs, setRuns] = createSignal<WorkflowRunDto[]>([]);
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal('');
  const [isStarting, setIsStarting] = createSignal(false);
  // Pre-run checklist: shown when the graph has problems (errors block the
  // run; warnings can be run past).
  const [checklist, setChecklist] = createSignal<WorkflowGraphCheck | null>(
    null,
  );
  const [isStopping, setIsStopping] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [showRuns, setShowRuns] = createSignal(false);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [resolvingId, setResolvingId] = createSignal<string | null>(null);

  const pendingApprovals = usePendingApprovals();
  const waitingHere = () =>
    pendingApprovals().filter((a) => a.taskId === props.taskId);
  const currentRun = () => runs()[0] ?? null;
  const isRunActive = () => currentRun()?.status === 'running';

  const load = async () => {
    try {
      const [taskResult, runsResult] = await Promise.all([
        getTask(props.taskId),
        listWorkflowRuns(props.taskId),
      ]);
      if (taskResult.ok) {
        setTask(taskResult.data);
        setLoadError(null);
      } else {
        setLoadError(taskResult.error.message);
      }
      if (runsResult.ok) setRuns(runsResult.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  };

  /** Reload the header, runs and canvas. */
  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    void load();
  };
  const scheduleRefresh = debounced(refreshAll);

  onWorkflowUpdated((taskId) => {
    if (taskId === null || taskId === props.taskId) scheduleRefresh();
  });

  // Without live updates, poll while a run is going.
  const pollForChanges = () => !ws.isConnected() && isRunActive();
  createEffect(() => {
    if (!pollForChanges()) return;
    const interval = window.setInterval(() => {
      void load();
      refreshPendingApprovals();
    }, 5000);
    onCleanup(() => window.clearInterval(interval));
  });

  onMount(() => {
    void load();
    void (async () => {
      try {
        const result = await listAgents();
        setAgents(result.items);
      } catch (err) {
        setActionError(
          `Couldn't load agents: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  });

  const handleBack = () => props.onBack();

  const startEditingTitle = () => {
    setTitleDraft(task()?.title ?? '');
    setIsEditingTitle(true);
  };

  const saveTitle = async () => {
    const title = titleDraft().trim();
    setIsEditingTitle(false);
    if (!title || title === task()?.title) return;
    const result = await updateTask(props.taskId, { title });
    if (result.ok) {
      setTask((prev) => (prev ? { ...prev, title: result.data.title } : prev));
    } else {
      setActionError(`Couldn't rename: ${result.error.message}`);
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    const result = await updateTaskStatus(props.taskId, status);
    if (result.ok) {
      setTask((prev) =>
        prev ? { ...prev, status: result.data.status } : prev,
      );
    } else {
      setActionError(`Couldn't change status: ${result.error.message}`);
    }
  };

  const startRun = async () => {
    setChecklist(null);
    setIsStarting(true);
    setActionError(null);
    try {
      const result = await executeTask(props.taskId);
      if (!result.ok) {
        const issues = result.error.details?.['issues'];
        if (result.error.code === 'workflow.invalid_graph' && issues) {
          setChecklist({
            ok: false,
            errors: issues as WorkflowGraphCheck['errors'],
            warnings: [],
          });
          return;
        }
        throw new Error(result.error.message);
      }
      refreshAll();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to run workflow',
      );
    } finally {
      setIsStarting(false);
    }
  };

  /** Run, after showing the checklist if the graph has any problems. */
  const handleRun = async () => {
    setIsStarting(true);
    const check = await checkWorkflow(props.taskId).catch(() => null);
    setIsStarting(false);
    // If the check itself fails, the server still validates on start.
    if (
      check?.ok &&
      (check.data.errors.length > 0 || check.data.warnings.length > 0)
    ) {
      setChecklist(check.data);
      return;
    }
    await startRun();
  };

  const handleStop = async () => {
    setIsStopping(true);
    setActionError(null);
    try {
      const result = await cancelWorkflowRun(props.taskId);
      if (!result.ok) throw new Error(result.error.message);
      refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to stop');
    } finally {
      setIsStopping(false);
    }
  };

  const handleDecision = async (
    subtaskId: string,
    decision: 'approved' | 'rejected',
  ) => {
    setResolvingId(subtaskId);
    setActionError(null);
    try {
      const result = await resolveApproval(subtaskId, decision);
      if (!result.ok) throw new Error(result.error.message);
      refreshPendingApprovals();
      refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setResolvingId(null);
    }
  };

  /** "2 of 5 steps done" while running, else how long the run took. */
  const runSummary = () => {
    const run = currentRun();
    if (!run) return null;
    if (run.status === 'running') {
      const subtasks = task()?.subtasks ?? [];
      const done = subtasks.filter(
        (s) =>
          s.status === 'completed' ||
          s.status === 'failed' ||
          s.status === 'skipped',
      ).length;
      return subtasks.length > 0
        ? `${done} of ${subtasks.length} steps done`
        : '';
    }
    const finished = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
    return formatDuration(finished - Date.parse(run.startedAt));
  };

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete "${task()?.title ?? 'this workflow'}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      const result = await deleteTask(props.taskId);
      if (!result.ok) throw new Error(result.error.message);
      handleBack();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to delete workflow',
      );
      setIsDeleting(false);
    }
  };

  return (
    <div class="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header — purpose-built for graph authoring, not a repurposed modal */}
      <div class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <button
          onClick={handleBack}
          class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
          title="Back to Workflows"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>

        <div class="hidden sm:flex w-7 h-7 rounded-lg bg-primary/10 items-center justify-center flex-shrink-0">
          <Workflow class="w-3.5 h-3.5 text-primary" />
        </div>

        <div class="flex items-center gap-2 min-w-0 flex-1">
          <Show
            when={!isEditingTitle()}
            fallback={
              <input
                type="text"
                value={titleDraft()}
                onInput={(e) => setTitleDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                onBlur={() => void saveTitle()}
                autofocus
                class="text-base font-semibold bg-white dark:bg-gray-900 border border-primary rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/30 text-text-primary min-w-0 flex-1"
              />
            }
          >
            <button
              onClick={startEditingTitle}
              class="group flex items-center gap-1.5 min-w-0 text-left"
              title="Click to rename"
            >
              <h1 class="text-base font-semibold text-text-primary truncate">
                {task()?.title || 'Untitled workflow'}
              </h1>
              <Pencil class="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 flex-shrink-0" />
            </button>
          </Show>

          <Show when={currentRun()}>
            {(run) => (
              <button
                type="button"
                onClick={() => setShowRuns(true)}
                class={`hidden md:inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 flex-shrink-0 ${RUN_PILL[run().status]}`}
                title={run().error ?? 'Show runs'}
              >
                <Show when={run().status === 'running'}>
                  <Loader2 class="w-3 h-3 animate-spin" />
                </Show>
                {RUN_STATUS_LABEL[run().status]}
                <Show when={runSummary()}>
                  <span class="font-normal opacity-80">· {runSummary()}</span>
                </Show>
              </button>
            )}
          </Show>

          <Show when={task()}>
            <select
              value={task()!.status}
              onChange={(e) =>
                void handleStatusChange(e.currentTarget.value as TaskStatus)
              }
              class={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer flex-shrink-0 ${STATUS_COLORS[task()!.status]}`}
            >
              <For each={STATUS_OPTIONS}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
          </Show>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <Show when={actionError()}>
            <span class="text-xs text-red-600 dark:text-red-400 max-w-xs truncate">
              {actionError()}
            </span>
          </Show>
          <button
            onClick={() => setShowRuns((v) => !v)}
            class={`p-1.5 rounded-lg transition-colors ${
              showRuns()
                ? 'bg-primary/10 text-primary'
                : 'text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="Runs"
            aria-pressed={showRuns()}
          >
            <History class="w-4 h-4" />
          </button>
          <Show
            when={isRunActive()}
            fallback={
              <button
                onClick={() => void handleRun()}
                disabled={isStarting()}
                class="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg shadow-sm text-sm font-medium disabled:opacity-50 transition-colors"
              >
                <Play class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">
                  {isStarting() ? 'Starting…' : 'Run'}
                </span>
              </button>
            }
          >
            <button
              onClick={() => void handleStop()}
              disabled={isStopping()}
              class="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg shadow-sm text-sm font-medium disabled:opacity-50 transition-colors"
            >
              <Square class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">
                {isStopping() ? 'Stopping…' : 'Stop'}
              </span>
            </button>
          </Show>
          <button
            onClick={() => void handleDelete()}
            disabled={isDeleting()}
            class="p-1.5 rounded-lg text-text-tertiary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
            title="Delete workflow"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>

      <For each={waitingHere()}>
        {(approval) => (
          <div
            role="status"
            class="flex flex-wrap items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm"
          >
            <Hourglass class="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span class="flex-1 min-w-0 text-amber-800 dark:text-amber-200">
              <span class="font-medium">{approval.title}</span> is waiting for
              your approval.
            </span>
            <button
              type="button"
              disabled={resolvingId() === approval.subtaskId}
              onClick={() =>
                void handleDecision(approval.subtaskId, 'approved')
              }
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
            >
              <Check class="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              type="button"
              disabled={resolvingId() === approval.subtaskId}
              onClick={() =>
                void handleDecision(approval.subtaskId, 'rejected')
              }
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              <X class="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
      </For>

      <Show when={loadError()}>
        <div class="px-4 py-2 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-800">
          Couldn't load this workflow: {loadError()}
        </div>
      </Show>

      {/* Graph canvas + property panel — fills the rest of the viewport */}
      <div class="relative flex-1 min-h-0 flex">
        <div class="flex-1 min-w-0 min-h-0">
          <Show
            when={!isLoading()}
            fallback={
              <div class="h-full flex flex-col items-center justify-center gap-2 text-text-tertiary">
                <div class="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span class="text-sm">Loading workflow…</span>
              </div>
            }
          >
            <WorkflowEditor
              taskId={props.taskId}
              agents={agents()}
              refreshKey={refreshKey()}
              pollForChanges={pollForChanges()}
              onRunChanged={refreshAll}
              locked={isRunActive()}
            />
          </Show>
        </div>
        <Show when={showRuns()}>
          {/* Overlays the canvas on narrow screens instead of squeezing it. */}
          <div class="absolute inset-y-0 right-0 z-20 shadow-xl sm:shadow-none sm:static w-80 max-w-[85vw] flex-shrink-0">
            <WorkflowRunsPanel
              runs={runs()}
              onClose={() => setShowRuns(false)}
            />
          </div>
        </Show>
      </div>
      <ConfirmDialog
        isOpen={checklist() !== null}
        title={
          (checklist()?.errors.length ?? 0) > 0
            ? 'Fix these before running'
            : 'Run this workflow?'
        }
        body={
          <div class="space-y-3 text-sm">
            <Show when={(checklist()?.errors.length ?? 0) > 0}>
              <ul class="space-y-1.5">
                <For each={checklist()?.errors ?? []}>
                  {(issue) => (
                    <li class="flex gap-2 text-red-700 dark:text-red-300">
                      <X class="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{issue.message}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={(checklist()?.warnings.length ?? 0) > 0}>
              <ul class="space-y-1.5">
                <For each={checklist()?.warnings ?? []}>
                  {(issue) => (
                    <li class="flex gap-2 text-amber-700 dark:text-amber-300">
                      <AlertTriangle class="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{issue.message}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        }
        confirmLabel={
          (checklist()?.errors.length ?? 0) > 0 ? 'Run' : 'Run anyway'
        }
        cancelLabel="Back to editing"
        confirmDisabled={(checklist()?.errors.length ?? 0) > 0}
        isPending={isStarting()}
        onConfirm={() => void startRun()}
        onCancel={() => setChecklist(null)}
      />
    </div>
  );
}
