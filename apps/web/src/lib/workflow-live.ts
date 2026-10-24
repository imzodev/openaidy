/**
 * Live workflow state shared across pages.
 *
 * The server sends a `workflow.updated` WebSocket event whenever a run or
 * one of its steps changes. Pages subscribe with `onWorkflowUpdated` and
 * refetch what they show; `usePendingApprovals` keeps one app-wide list of
 * approval steps waiting for a decision (sidebar badge, list chips, the
 * banner on a workflow page).
 */

import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js';
import {
  WORKFLOW_UPDATED_EVENT,
  type WorkflowUpdatedPayload,
} from '@openaidy/shared-types';
import { useWebSocketContext } from './ws-provider';
import { listPendingApprovals } from './api-tasks';
import type { PendingApprovalDto } from './types';

/**
 * Call `handler` with the task id of every workflow that changes. Also
 * fires (with `null`) when the WebSocket reconnects, since events may have
 * been missed while it was down.
 */
export function onWorkflowUpdated(handler: (taskId: string | null) => void) {
  const ws = useWebSocketContext();
  createEffect(() => {
    const client = ws.client();
    if (!client) return;
    const off = client.on<{ payload?: WorkflowUpdatedPayload }>(
      WORKFLOW_UPDATED_EVENT,
      (message) => {
        const taskId = message?.payload?.taskId;
        if (taskId) handler(taskId);
      },
    );
    onCleanup(off);
  });
  let wasConnected = ws.isConnected();
  createEffect(() => {
    const connected = ws.isConnected();
    if (connected && !wasConnected) handler(null);
    wasConnected = connected;
  });
}

/** Debounce a refresh so a burst of events triggers one fetch. */
export function debounced(fn: () => void, ms = 200): () => void {
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}

const [pendingApprovals, setPendingApprovals] = createSignal<
  PendingApprovalDto[]
>([]);
let refreshTimer: number | undefined;

/** Refetch the waiting approvals (debounced across all callers). */
export function refreshPendingApprovals(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void listPendingApprovals()
      .then((result) => {
        if (result.ok) setPendingApprovals(result.data);
      })
      .catch(() => {
        // Keep the last known list; the next event or reconnect retries.
      });
  }, 150);
}

/** Approval steps waiting for a decision, kept fresh while mounted. */
export function usePendingApprovals(): Accessor<PendingApprovalDto[]> {
  onMount(refreshPendingApprovals);
  onWorkflowUpdated(refreshPendingApprovals);
  return pendingApprovals;
}
