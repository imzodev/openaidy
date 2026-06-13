/**
 * ConfirmDialog types
 *
 * Per project convention, types and interfaces are exported from
 * type files and imported wherever they're needed. The
 * `ConfirmDialog` component imports from here.
 */

import type { JSX } from 'solid-js';

/**
 * Visual tone of the confirm action. Drives the colour of the
 * primary action button and the optional icon shown in the title.
 *
 * - `default` — neutral blue/primary colour, no icon
 * - `danger`  — red colour, no icon (caller may add their own)
 */
export type ConfirmDialogTone = 'default' | 'danger';

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  body: JSX.Element;
  /**
   * Label for the primary action button. Defaults to "Confirm".
   */
  confirmLabel?: string;
  /**
   * Label for the cancel button. Defaults to "Cancel".
   */
  cancelLabel?: string;
  /**
   * Visual tone. `danger` styles the primary button in red so
   * destructive actions (delete, disconnect, …) are unambiguous.
   */
  tone?: ConfirmDialogTone;
  /**
   * Disables both buttons and shows a spinner-style "Working…"
   * label on the primary button while a mutation is in flight.
   */
  isPending?: boolean;
  /**
   * Force the primary button to be disabled (e.g. when a
   * pre-flight check determined the action can't proceed in the
   * current state). When `true`, the cancel button stays enabled
   * so the user can dismiss.
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};
