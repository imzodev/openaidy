/**
 * Configuration schema for the execution section
 *
 * Defines the schema for task/subtask execution tuning: subtask retry
 * count and dependency-context truncation limits.
 */

import type { SectionSchema } from '../schema';

/**
 * Get the execution section schema
 */
export function getExecutionSectionSchema(): SectionSchema {
  return {
    id: 'execution',
    title: 'Task Execution',
    description:
      'Tune how subtasks retry on failure and how much context is carried between dependent subtasks.',
    fields: [
      {
        type: 'number',
        key: 'execution.maxRetries',
        label: 'Max Retries',
        required: true,
        description:
          'Max retry attempts for a failed subtask before it is marked failed.',
        helpText:
          'A flaky subtask (e.g. one that depends on an unreliable tool) may benefit from more attempts; a subtask that fails deterministically should fail fast instead of retrying.',
        min: 1,
        max: 20,
        step: 1,
      },
      {
        type: 'number',
        key: 'execution.depContextPerItemChars',
        label: 'Per-Dependency Context Limit (chars)',
        required: true,
        description:
          "Max characters of a single completed dependency's result carried into a downstream subtask's prompt.",
        helpText:
          'Raise this if downstream subtasks need more of the source material from a single dependency (e.g. a long research result feeding a drafting subtask).',
        min: 100,
        max: 50000,
        step: 100,
      },
      {
        type: 'number',
        key: 'execution.depContextTotalChars',
        label: 'Total Dependency Context Limit (chars)',
        required: true,
        description:
          "Max combined characters of all completed dependencies' results carried into one subtask's prompt.",
        helpText:
          'Bounds the total context added when a subtask has several completed dependencies, so it cannot unboundedly grow the next prompt.',
        min: 100,
        max: 200000,
        step: 100,
      },
    ],
  };
}
