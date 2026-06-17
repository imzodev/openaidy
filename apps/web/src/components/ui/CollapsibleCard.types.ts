/**
 * Types for CollapsibleCard
 *
 * Per project convention, types and interfaces are exported from
 * type files and imported wherever they're needed.
 */

import type { JSX } from 'solid-js';

export type CollapsibleCardProps = {
  title: string;
  index?: number;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'info' | 'warning' | 'error';
  description?: string;
  showEnabled?: boolean;
  enabled?: boolean;
  onDelete?: () => void;
  /**
   * Optional banner shown at the top of the card body. Used by
   * the Agents tab to flag agents whose model was auto-rewired
   * during a provider disconnect, so the user understands why the
   * value changed without having to remember.
   */
  notice?: JSX.Element;
  children: JSX.Element;
  isPending?: boolean;
  initiallyCollapsed?: boolean;
};
