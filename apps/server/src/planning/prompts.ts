/**
 * Planning Prompts
 *
 * Prompt builders for the planning agent.
 */

import type { Task } from '@openaidy/db';

/**
 * Build the planning prompt for a task
 */
export function buildPlanningPrompt(task: Task): string {
  return `Please analyze the following task and break it down into subtasks.

Task Title: ${task.title}

Task Description:
${task.description}

Requirements:
1. Break down into 3-10 subtasks
2. Each subtask should be atomic and completable independently
3. Order subtasks logically (dependencies first)
4. Include clear titles and descriptions
5. Specify dependencies between subtasks

Return the subtasks as a JSON array.`;
}

/**
 * Build a refinement prompt for adjusting a plan
 */
export function buildRefinementPrompt(
  task: Task,
  existingSubtasks: Array<{ title: string; description: string }>,
  feedback: string
): string {
  return `Please refine the task decomposition based on the following feedback.

Task Title: ${task.title}

Current Subtasks:
${existingSubtasks.map((s, i) => `${i + 1}. ${s.title}: ${s.description}`).join('\n')}

Feedback:
${feedback}

Please provide an updated list of subtasks as a JSON array.`;
}

/**
 * Build a prompt for adding more subtasks
 */
export function buildExpansionPrompt(
  task: Task,
  existingCount: number,
  targetCount: number
): string {
  return `Please add more subtasks to the following task decomposition.

Task Title: ${task.title}

Current number of subtasks: ${existingCount}
Target number of subtasks: ${targetCount}

Please provide additional subtasks that would help complete this task.
Return only the new subtasks as a JSON array.`;
}
