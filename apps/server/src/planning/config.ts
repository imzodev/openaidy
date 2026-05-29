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
6. Identify the expected deliverable for this task

Output format:
Return a JSON object with:
- subtasks: Array of subtask objects, each with:
  - title: Short, clear title
  - description: Detailed description of what needs to be done
  - dependencies: Array of subtask indices this depends on (optional)
- deliverable: Object describing the expected output with:
  - type: One of 'document', 'image', 'code', 'report', 'data', 'link', 'other'
  - description: Clear description of what the deliverable is

Example output:
{
  "subtasks": [
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
  ],
  "deliverable": {
    "type": "code",
    "description": "Source code repository with working REST API endpoints for CRUD operations"
  }
}`,

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
