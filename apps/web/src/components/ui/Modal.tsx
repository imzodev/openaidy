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
          class="absolute inset-0 bg-black/25 dark:bg-black/50 backdrop-blur-[3px] animate-fade-in"
          onClick={props.onClose}
          aria-hidden="true"
        />

        {/* Modal Content — capped to the viewport height with a scrollable
            body so long forms never get clipped with no way to reach the
            rest of the content or the footer actions below the fold. */}
        <div
          class={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 w-full mx-4 max-h-[90vh] flex flex-col animate-sheet-in ${sizeClass()}`}
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <Show when={props.title}>
            <div class="flex items-center justify-between pl-5 pr-3 py-3 hairline-b shrink-0">
              <h2 class="text-[17px] font-semibold tracking-tight text-text-primary">
                {props.title}
              </h2>
              <button
                onClick={props.onClose}
                class="w-7 h-7 flex items-center justify-center rounded-full bg-fill text-text-tertiary hover:bg-fill-strong hover:text-text-primary transition-colors"
                aria-label="Close modal"
              >
                <X class="w-4 h-4" stroke-width={2.25} />
              </button>
            </div>
          </Show>

          {/* Close button if no title */}
          <Show when={!props.title}>
            <button
              onClick={props.onClose}
              class="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-fill text-text-tertiary hover:bg-fill-strong hover:text-text-primary transition-colors"
              aria-label="Close modal"
            >
              <X class="w-4 h-4" stroke-width={2.25} />
            </button>
          </Show>

          {/* Body */}
          <div class="p-5 overflow-y-auto min-h-0">{props.children}</div>
        </div>
      </div>
    </Show>
  );
}
