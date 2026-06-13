/**
 * Types for PresetProviderCard
 *
 * Per project convention, types are exported from type files and
 * imported wherever they're needed.
 */

import type { ProviderPreset } from '@openaidy/shared-types';

export type PresetProviderCardProps = {
  preset: ProviderPreset;
  isConfigured: boolean;
  onSelect: (preset: ProviderPreset) => void;
  /**
   * Optional callback fired when the user clicks the inline
   * disconnect icon. Only rendered when the provider is configured
   * AND the callback is provided — when omitted (e.g. an
   * integration that doesn't want the destructive shortcut), the
   * user can still disconnect via the management modal.
   */
  onDisconnect?: (preset: ProviderPreset) => void;
  /**
   * Disables the inline disconnect icon button while a disconnect
   * mutation is in flight. Forwarded by the parent; the icon
   * itself stays in the DOM so layout doesn't shift mid-action.
   */
  isDisconnectPending?: boolean;
};
