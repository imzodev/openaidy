/**
 * Planning Prompts
 *
 * Prompt builders for the planning agent.
 */

import type { Task } from '@openaidy/db';

/**
 * Build the planning prompt for a task
 */
export function buildPlanningPrompt(
  task: Task,
  maxSubtasks: number = 10,
): string {
  return `Please analyze the following task and break it down into subtasks.

Task Title: ${task.title}

Task Description:
${task.description}

Requirements:
1. Break down into 1-${maxSubtasks} subtasks — use as FEW as needed, do not pad with unnecessary steps
2. Each subtask should be atomic and completable independently
3. Order subtasks logically (dependencies first)
4. Include clear titles and descriptions
5. Specify dependencies between subtasks

Return the subtasks as a JSON array.`;
}

/**
 * Build the complexity assessment prompt for a task
 */
export function buildComplexityPrompt(task: Task): string {
  return `Evaluate how many subtasks are needed to complete this task.

Task Title: ${task.title}
Task Description: ${task.description}

Respond with ONLY valid JSON in this exact format:
{"complexity":"simple","maxSubtasks":2}

Rules:
- "simple": task is a single focused action (quick query, short text, small fix) → maxSubtasks: 2
- "moderate": task has a few well-defined phases → maxSubtasks: 4
- "complex": task is multi-faceted with many coordinated steps → maxSubtasks: 8

Be conservative. If unsure, choose the simpler classification.`;
}

/**
 * Build a refinement prompt for adjusting a plan
 */
export function buildRefinementPrompt(
  task: Task,
  existingSubtasks: Array<{ title: string; description: string }>,
  feedback: string,
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
  targetCount: number,
): string {
  return `Please add more subtasks to the following task decomposition.

Task Title: ${task.title}

Current number of subtasks: ${existingCount}
Target number of subtasks: ${targetCount}

Please provide additional subtasks that would help complete this task.
Return only the new subtasks as a JSON array.`;
}
