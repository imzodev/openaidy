/**
 * Planning Prompts
 *
 * Prompt builders for the planning agent.
 */

import fs from 'fs';
import path from 'path';
import type { AgentSummary } from '../agents/schema';
import type { Task } from '@openaidy/db';

/**
 * Build the agent context section for the planning prompt
 */
export function buildAgentContextPrompt(
  agents: AgentSummary[],
  openAidyHome: string,
): string {
  if (agents.length === 0) {
    return 'No agents available for assignment.';
  }

  const agentProfiles = agents.map((agent) => {
    // Read AGENT.md if exists
    let agentMdContent = '';
    const agentMdPath = path.join(
      openAidyHome,
      '.openaidy',
      'workspaces',
      agent.id,
      'AGENT.md',
    );

    if (fs.existsSync(agentMdPath)) {
      try {
        agentMdContent = fs.readFileSync(agentMdPath, 'utf-8');
      } catch {
        // Ignore read errors
      }
    }

    return `
## ${agent.name} (${agent.id})
- Description: ${agent.description || 'No description'}
- Tools: ${agent.tools?.join(', ') || 'None'}
- Skills: ${agent.skills?.join(', ') || 'None'}
- MCP Servers: ${agent.mcpServers?.map((m) => m.id).join(', ') || 'None'}
${agentMdContent ? `\nSpecialization (from AGENT.md):\n${agentMdContent}` : ''}
`;
  });

  return `Available Agents:
${agentProfiles.join('\n')}

When assigning agents to subtasks, consider:
1. Tool availability - use agents with required tools
2. Skill match - prefer agents with relevant skills
3. Specialization - check AGENT.md for domain expertise
4. Keep workload balanced across agents`;
}

/**
 * Build the planning prompt for a task
 */
export function buildPlanningPrompt(
  task: Task,
  maxSubtasks: number,
  agentContext?: string,
): string {
  let basePrompt = `Please analyze the following task and break it down into subtasks and assign the best agent for each.

Task Title: ${task.title}

Task Description:
${task.description}`;

  if (agentContext) {
    basePrompt += `\n\n${agentContext}`;
  } else {
    basePrompt += '\n\n(No agent context available - assign agents manually)';
  }

  basePrompt += `

Requirements:
1. Break down into 1-${maxSubtasks} subtasks — use as FEW as needed, do not pad with unnecessary steps
2. Each subtask should be atomic and completable independently
3. Order subtasks logically (dependencies first)
4. Include clear titles and descriptions
5. Specify dependencies between subtasks
6. Assign the best agent for each subtask based on capabilities

Return the subtasks as a JSON array with:
- title: Short, clear title
- description: Detailed description of what needs to be done
- dependencies: Array of subtask indices this depends on (optional)
- assignedAgentId: ID of the agent best suited for this subtask (optional)
- assignmentReason: Brief explanation of why this agent was chosen (optional)`;

  return basePrompt;
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
