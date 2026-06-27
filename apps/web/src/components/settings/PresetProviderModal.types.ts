/**
 * Types for PresetProviderModal
 *
 * Per project convention, types and interfaces are exported from
 * type files and imported wherever they're needed. The
 * `PresetProviderModal` component imports from here.
 */

import type { ProviderConfig } from '../../lib/api';
import type { ProviderPreset } from '@openaidy/shared-types';

export type PresetProviderModalProps = {
  preset: ProviderPreset;
  existingProvider?: ProviderConfig;
  onClose: () => void;
  /**
   * Receives the providers to persist. Usually one, but OpenCode
   * Go splits enabled models across `opencode-go` and
   * `opencode-go-anthropic` so the modal can return two when both
   * families have enabled models.
   */
  onSave: (providers: ProviderConfig[]) => void;
  /**
   * Fires when the user clicks the "Disconnect" link in the
   * footer. Only present when `existingProvider` is set (i.e. the
   * provider has already been configured at least once). The
   * parent is responsible for showing the confirmation dialog and
   * for the actual disconnect + config-cleanup side effects.
   */
  onDisconnect?: (preset: ProviderPreset) => void;
  isPending: boolean;
};
