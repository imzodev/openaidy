/**
 * Configuration schema for the defaults section
 *
 * Defines the schema for the application defaults including
 * default provider, model, and agent selection.
 */

import type { SectionSchema } from '../schema';

/**
 * Get the defaults section schema
 *
 * @param providers - List of available providers for the select dropdown
 * @param agents - List of available agents for the select dropdown
 */
export function getDefaultsSectionSchema(options?: {
  providers?: Array<{ id: string; name: string }>;
  agents?: Array<{ id: string; name: string }>;
}): SectionSchema {
  const providerOptions =
    options?.providers?.map((p) => ({
      value: p.id,
      label: p.name,
    })) ?? [];

  const agentOptions =
    options?.agents?.map((a) => ({
      value: a.id,
      label: a.name,
    })) ?? [];

  return {
    id: 'defaults',
    title: 'Default Settings',
    description:
      'Configure the default provider, model, and agent for new sessions.',
    fields: [
      {
        type: 'select',
        key: 'defaults.providerId',
        label: 'Default Provider',
        required: true,
        description:
          'The provider to use when no specific provider is specified.',
        helpText:
          'This provider will be used as the default for new conversations and when agents do not specify a provider.',
        options: providerOptions,
        placeholder: 'Select a provider...',
      },
      {
        type: 'string',
        key: 'defaults.modelId',
        label: 'Default Model',
        required: true,
        description: 'The model ID to use when no specific model is specified.',
        helpText:
          'Enter the model identifier (e.g., gpt-4o-mini, claude-3-opus). This should match a model available from your default provider.',
        placeholder: 'e.g., gpt-4o-mini',
      },
      {
        type: 'select',
        key: 'defaults.agentId',
        label: 'Default Agent',
        required: true,
        description: 'The agent to use for new conversations.',
        helpText:
          'Agents define the system prompt and behavior. The default agent will be used when no specific agent is selected.',
        options: agentOptions,
        placeholder: 'Select an agent...',
      },
    ],
  };
}
