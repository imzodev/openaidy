/**
 * ConfirmDialog
 *
 * A reusable confirm/cancel modal built on top of the existing
 * `Modal` primitive. Use this for any "are you sure?" prompt that
 * needs to match the rest of the themed UI (native `window.confirm`
 * breaks the dark/light theme and can't render rich content).
 *
 * Example:
 *
 *   const [open, setOpen] = createSignal(false);
 *   <ConfirmDialog
 *     isOpen={open()}
 *     title="Disconnect from MiniMax?"
 *     tone="danger"
 *     confirmLabel="Disconnect"
 *     isPending={disconnectMutation.isPending}
 *     onConfirm={() => { doDisconnect(); setOpen(false); }}
 *     onCancel={() => setOpen(false)}
 *   >
 *     <p>This will sign you out and remove the model from your
 *        agent. You can reconnect at any time.</p>
 *   </ConfirmDialog>
 */

import { Show } from 'solid-js';
import { Modal } from './Modal';
import type { ConfirmDialogProps } from './ConfirmDialog.types';

export function ConfirmDialog(props: ConfirmDialogProps) {
  const tone = () => props.tone ?? 'default';
  const confirmLabel = () => props.confirmLabel ?? 'Confirm';
  const cancelLabel = () => props.cancelLabel ?? 'Cancel';

  const primaryButtonClass = () =>
    tone() === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-primary hover:bg-primary-hover text-white';

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      title={props.title}
      size="sm"
    >
      <div class="space-y-4">
        <div class="text-sm text-text-secondary">{props.body}</div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.isPending}
            class="px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel()}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.isPending || props.confirmDisabled}
            class={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${primaryButtonClass()}`}
          >
            <Show when={props.isPending} fallback={confirmLabel()}>
              Working…
            </Show>
          </button>
        </div>
      </div>
    </Modal>
  );
}
