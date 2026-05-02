// TODO: Create a src/constants/ folder and move all UI constants (including this file) there

import type { SkillSource } from './api';

export type SkillSourceBadgeVariant = 'gray' | 'blue' | 'yellow' | 'purple';

export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  preinstalled: 'Pre-installed',
  modified: 'Modified',
  'user-global': 'Custom',
  agent: 'Agent',
};

export const SKILL_SOURCE_BADGE: Record<SkillSource, SkillSourceBadgeVariant> =
  {
    preinstalled: 'gray',
    modified: 'yellow',
    'user-global': 'blue',
    agent: 'purple',
  };

export const SKILL_SOURCE_BADGE_CLASSES: Record<
  SkillSourceBadgeVariant,
  string
> = {
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  yellow:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  purple:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};
