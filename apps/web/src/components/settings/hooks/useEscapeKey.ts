import { onCleanup, createEffect, on } from 'solid-js';

/**
 * useEscapeKey Hook
 *
 * A reusable hook for handling Escape key presses to close modals or dialogs.
 * Follows Single Responsibility Principle by isolating escape key logic.
 *
 * @param callback - Function to call when Escape is pressed
 * @param isEnabled - Signal or function that determines if the listener is active
 */
export function useEscapeKey(callback: () => void, isEnabled: () => boolean) {
  createEffect(
    on(isEnabled, (enabled) => {
      if (!enabled) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          callback();
        }
      };

      document.addEventListener('keydown', handleKeyDown);

      onCleanup(() => {
        document.removeEventListener('keydown', handleKeyDown);
      });
    }),
  );
}
