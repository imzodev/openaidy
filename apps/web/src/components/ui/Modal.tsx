/**
 * Modal Component
 *
 * A reusable modal dialog with overlay, close button, and keyboard support.
 */

import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import { X } from 'lucide-solid';

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const SIZE_CLASSES: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

export function Modal(props: ModalProps) {
  // Handle Escape key to close
  createEffect(() => {
    if (props.isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          props.onClose();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
    }
  });

  // Prevent body scroll when modal is open
  createEffect(() => {
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
      onCleanup(() => {
        document.body.style.overflow = '';
      });
    }
  });

  const sizeClass = () => SIZE_CLASSES[props.size || 'md'];

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Overlay */}
        <div
          class="absolute inset-0 bg-black/50"
          onClick={props.onClose}
          aria-hidden="true"
        />

        {/* Modal Content — capped to the viewport height with a scrollable
            body so long forms never get clipped with no way to reach the
            rest of the content or the footer actions below the fold. */}
        <div
          class={`relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full mx-4 max-h-[90vh] flex flex-col ${sizeClass()}`}
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <Show when={props.title}>
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {props.title}
              </h2>
              <button
                onClick={props.onClose}
                class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors"
                aria-label="Close modal"
              >
                <X class="w-5 h-5" />
              </button>
            </div>
          </Show>

          {/* Close button if no title */}
          <Show when={!props.title}>
            <button
              onClick={props.onClose}
              class="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X class="w-5 h-5" />
            </button>
          </Show>

          {/* Body */}
          <div class="p-4 overflow-y-auto min-h-0">{props.children}</div>
        </div>
      </div>
    </Show>
  );
}
