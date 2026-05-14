/**
 * Planning Agent Configuration
 *
 * Configuration for the planning agent that decomposes tasks into subtasks.
 */

/**
 * Planning agent configuration
 */
export const PLANNING_AGENT_CONFIG = {
  name: 'planning-agent',
  description: 'Agent that decomposes tasks into subtasks',

  systemPrompt: `You are a planning agent. Your role is to analyze tasks and break them down into smaller, actionable subtasks.

When given a task:
1. Analyze the task description and requirements
2. Identify the main components or steps needed
3. Create a list of subtasks with clear titles and descriptions
4. Ensure each subtask is atomic and can be completed independently
5. Order subtasks logically (dependencies first)

Output format:
Return a JSON array of subtasks, each with:
- title: Short, clear title
- description: Detailed description of what needs to be done
- dependencies: Array of subtask indices this depends on (optional)

Example output:
[
  {
    "title": "Set up database schema",
    "description": "Create the database tables and indexes needed for the feature",
    "dependencies": []
  },
  {
    "title": "Implement API endpoints",
    "description": "Create the REST API endpoints for CRUD operations",
    "dependencies": [0]
  }
]`,

  /**
   * Model requirements for planning
   */
  modelRequirements: {
    minContextLength: 4096,
    supportsJson: true,
  },

  /**
   * Default planning options
   */
  defaults: {
    maxSubtasks: 10,
    maxDepth: 3,
  },
};

/**
 * Planning options
 */
export type PlanningOptions = {
  maxSubtasks?: number;
  maxDepth?: number;
};

/**
 * Planned subtask from AI response
 */
export type PlannedSubtask = {
  title: string;
  description: string;
  dependencies: number[];
  assignedAgentId?: string;
  assignmentReason?: string;
};
