/**
 * Configuration schema for the agents section
 *
 * Defines the schema for agent configuration including
 * system prompts and model selection.
 */

import type { SectionSchema, FieldSchema } from '../schema';

/**
 * Agent configuration schema
 */
const agentSchema: FieldSchema = {
  type: 'object',
  key: 'agents',
  label: 'Agent',
  properties: {
    id: {
      type: 'string',
      key: 'id',
      label: 'Agent ID',
      required: true,
      description: 'Unique identifier for this agent',
      placeholder: 'e.g., default, code-assistant',
      helpText:
        'Use lowercase letters, numbers, and hyphens. This ID is used to reference the agent in defaults and sessions.',
    },
    name: {
      type: 'string',
      key: 'name',
      label: 'Display Name',
      required: true,
      description: 'Human-readable name for this agent',
      placeholder: 'e.g., Default Assistant, Code Assistant',
    },
    description: {
      type: 'string',
      key: 'description',
      label: 'Description',
      multiline: true,
      description: 'Brief description of what this agent does',
      placeholder: 'A general-purpose assistant for everyday tasks',
    },
    enabled: {
      type: 'boolean',
      key: 'enabled',
      label: 'Enabled',
      defaultValue: true,
      description: 'Enable or disable this agent',
      helpText: 'Disabled agents cannot be selected for new sessions.',
    },
    systemPrompt: {
      type: 'string',
      key: 'systemPrompt',
      label: 'System Prompt',
      required: true,
      multiline: true,
      description: "The system prompt that defines the agent's behavior",
      placeholder: 'You are a helpful AI assistant...',
      helpText:
        'This prompt is sent at the beginning of each conversation to instruct the AI how to behave.',
    },
    model: {
      type: 'string',
      key: 'model',
      label: 'Model',
      required: true,
      description:
        'The model to use for this agent in "providerId/modelId" format',
      placeholder: 'e.g., openai/gpt-4o-mini',
      helpText:
        'Specify the provider and model using the format "providerId/modelId". For example, "openai/gpt-4o-mini" or "anthropic/claude-3-5-sonnet-20241022".',
    },
  },
};

/**
 * Get the agents section schema
 */
export function getAgentsSectionSchema(): SectionSchema {
  return {
    id: 'agents',
    title: 'Agents',
    description:
      'Configure AI agents with custom system prompts and model selection.',
    collapsible: true,
    defaultCollapsed: false,
    fields: [agentSchema],
  };
}
