/**
 * Configuration schema for the agents section
 *
 * Defines the schema for agent configuration including
 * system prompts, defaults, and capabilities.
 */

import type { SectionSchema, FieldSchema } from '../schema';

/**
 * Agent defaults schema
 */
const agentDefaultsSchema: FieldSchema = {
  type: 'object',
  key: 'defaults',
  label: 'Agent Defaults',
  properties: {
    providerId: {
      type: 'string',
      key: 'providerId',
      label: 'Provider ID',
      description:
        'Provider to use for this agent (optional, uses app default if not set)',
      placeholder: 'e.g., openai',
    },
    modelId: {
      type: 'string',
      key: 'modelId',
      label: 'Model ID',
      description:
        'Model to use for this agent (optional, uses provider default if not set)',
      placeholder: 'e.g., gpt-4o',
    },
    temperature: {
      type: 'number',
      key: 'temperature',
      label: 'Temperature',
      min: 0,
      max: 2,
      step: 0.1,
      description: 'Sampling temperature for this agent (0-2)',
      helpText: 'Override the provider default temperature for this agent.',
    },
    maxTokens: {
      type: 'number',
      key: 'maxTokens',
      label: 'Max Tokens',
      min: 1,
      description: 'Maximum tokens for responses',
      helpText: 'Override the provider default max tokens for this agent.',
    },
  },
};

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
    defaults: agentDefaultsSchema,
  },
};

/**
 * Get the agents section schema
 */
export function getAgentsSectionSchema(): SectionSchema {
  return {
    id: 'agents',
    title: 'Agents',
    description: 'Configure AI agents with custom system prompts and settings.',
    collapsible: true,
    defaultCollapsed: true,
    fields: [
      {
        type: 'array',
        key: 'agents',
        label: 'Agent',
        minItems: 1,
        itemSchema: agentSchema,
      },
    ],
  };
}
