/**
 * DeleteAgentModal
 *
 *Confirmation dialog for deleting an agent. Uses the shared Modal component
 *and renders a clear destructive-action prompt with the agent name.
 */

import { Show, createSignal } from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { Modal } from '../ui/Modal';
import { deleteAgent } from '../../lib/api';
import type { Agent } from '../../lib/api';

type Props = {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: (agentId: string) => void;
};

export function DeleteAgentModal(props: Props) {
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteAgent(props.agent.id);
      props.onDeleted(props.agent.id);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (isDeleting()) return;
    setError(null);
    props.onClose();
  };

  return (
    <Modal isOpen={props.isOpen} onClose={handleClose} title="" size="sm">
      <div class="flex flex-col items-center text-center">
        {/* Icon + Title */}
        <div class="mt-2 mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <AlertTriangle class="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>

        <h2 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          Delete agent?
        </h2>

        <p class="mb-1 text-sm text-gray-600 dark:text-gray-400">
          You are about to permanently delete
        </p>
        <p class="mb-3 text-base font-medium text-gray-900 dark:text-white">
          &ldquo;{props.agent.name}&rdquo;
        </p>
        <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
          This will remove the agent and its entire workspace directory. This
          action cannot be undone.
        </p>

        {/* Error banner */}
        <Show when={error()}>
          <div class="mb-4 w-full rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error()}
          </div>
        </Show>

        {/* Actions */}
        <div class="flex w-full gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isDeleting()}
            class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting()}
            class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <Show
              when={isDeleting()}
              fallback={
                <>
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Delete Agent
                </>
              }
            >
              <svg
                class="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              Deleting…
            </Show>
          </button>
        </div>
      </div>
    </Modal>
  );
}