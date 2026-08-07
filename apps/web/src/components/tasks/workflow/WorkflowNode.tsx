/**
 * A single subtask card on the workflow canvas. Two visual variants:
 * a standard rounded card for 'agent' subtasks, and an amber
 * diamond-accented card for 'approval_gate' subtasks (with a pulsing
 * badge while paused). Loop-configured agent subtasks get a small
 * corner badge showing their iteration count.
 */

import { Show } from 'solid-js';
import { Hourglass, Repeat, User } from 'lucide-solid';
import type { Subtask } from '../../../lib/api-tasks';
import type { Agent } from '../AgentSelector';
import { STATUS_ICONS, STATUS_COLORS } from '../subtask-status';
import { NODE_WIDTH, NODE_HEIGHT } from '../../../lib/workflow-layout';

export type WorkflowNodeProps = {
  subtask: Subtask;
  agents?: Agent[];
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  /** Pointer-down on the node body — starts a reposition drag. */
  onMoveStart?: (e: PointerEvent) => void;
  /** Pointer-down on the connect handle — starts a drag-to-connect. */
  onConnectStart?: (e: PointerEvent) => void;
};

function agentName(agents: Agent[] | undefined, agentId: string | null) {
  if (!agentId) return null;
  return agents?.find((a) => a.id === agentId)?.name ?? agentId;
}

const STATUS_BG: Record<string, string> = {
  pending: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
  assigned:
    'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  in_progress:
    'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  completed:
    'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  failed: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

export function WorkflowNode(props: WorkflowNodeProps) {
  const isApprovalGate = () => props.subtask.subtaskKind === 'approval_gate';
  const isAwaiting = () => Boolean(props.subtask.awaitingApprovalSince);
  const isLoop = () => props.subtask.loopMaxIterations != null;
  const statusLabel = () => props.subtask.status.replace('_', ' ');
  const kindLabel = () => (isApprovalGate() ? 'approval gate' : 'subtask');

  return (
    <div
      data-node-id={props.subtask.id}
      tabIndex={0}
      role="button"
      aria-label={`${props.subtask.title}, ${kindLabel()}, ${statusLabel()}${isAwaiting() ? ', awaiting approval' : ''}`}
      aria-pressed={props.selected}
      class={`absolute rounded-md border px-3 py-2 shadow-sm cursor-grab select-none transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        STATUS_BG[props.subtask.status] ?? STATUS_BG.pending
      } ${
        props.selected ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
      } ${isApprovalGate() ? 'border-amber-400 dark:border-amber-500' : ''}`}
      style={{
        left: `${props.x - NODE_WIDTH / 2}px`,
        top: `${props.y - NODE_HEIGHT / 2}px`,
        width: `${NODE_WIDTH}px`,
        height: `${NODE_HEIGHT}px`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect();
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onMoveStart?.(e);
      }}
    >
      <div class="flex items-start gap-1.5">
        <span
          class={`text-sm leading-none ${STATUS_COLORS[props.subtask.status]}`}
        >
          {STATUS_ICONS[props.subtask.status]}
        </span>
        <h4 class="text-xs font-medium text-gray-900 dark:text-gray-100 leading-tight line-clamp-2 flex-1">
          {props.subtask.title}
        </h4>
        <Show when={isApprovalGate()}>
          <span class="text-amber-500 flex-shrink-0" title="Approval gate">
            <Hourglass class="w-3.5 h-3.5" />
          </span>
        </Show>
      </div>

      <Show when={agentName(props.agents, props.subtask.assignedAgentId)}>
        <div class="mt-1.5 flex items-center gap-1 text-[11px] text-purple-600 dark:text-purple-400">
          <User class="w-3 h-3" />
          <span class="truncate">
            {agentName(props.agents, props.subtask.assignedAgentId)}
          </span>
        </div>
      </Show>

      <Show when={isAwaiting()}>
        <div
          role="status"
          class="mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 animate-pulse"
        >
          Awaiting approval
        </div>
      </Show>

      <Show when={isLoop()}>
        <div
          class="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-mono border border-indigo-200 dark:border-indigo-700"
          title={`Loop: iteration ${props.subtask.loopIterationCount ?? 0} of ${props.subtask.loopMaxIterations}`}
        >
          <Repeat class="w-2.5 h-2.5" />
          {props.subtask.loopIterationCount ?? 0}/
          {props.subtask.loopMaxIterations}
        </div>
      </Show>

      {/* Drag from here to another node to create a dependency edge. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Create dependency from ${props.subtask.title}`}
        title="Drag to another node to connect"
        class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-gray-400 dark:bg-gray-500 border-2 border-white dark:border-gray-900 cursor-crosshair hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          props.onConnectStart?.(e);
        }}
      />
    </div>
  );
}
