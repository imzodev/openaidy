/**
 * Types for PersonalityPresetCard
 *
 * Per project convention, prop types live beside the component in a
 * `.types.ts` file.
 */

import type { PersonalityPreset } from '@openaidy/shared-types';

export type PersonalityPresetCardProps = {
  preset: PersonalityPreset;
  selected: boolean;
  onSelect: (preset: PersonalityPreset) => void;
};
