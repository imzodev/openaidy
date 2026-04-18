/**
 * Config schemas index
 *
 * Exports schema builders for all configuration sections.
 */

export { getDefaultsSectionSchema } from './defaults-schema';
export {
  getProvidersSectionSchema,
  getProvidersSectionSchemaWithModels,
  getVendorSpecificFields,
} from './providers-schema';
export { getAgentsSectionSchema } from './agents-schema';

import type { FormSchema, SectionSchema } from '../schema';
import { getDefaultsSectionSchema } from './defaults-schema';
import { getProvidersSectionSchema } from './providers-schema';
import { getAgentsSectionSchema } from './agents-schema';

/**
 * Options for building the complete form schema
 */
export type BuildFormSchemaOptions = {
  providers?: Array<{ id: string; name: string }>;
  agents?: Array<{ id: string; name: string }>;
  includeProviders?: boolean;
  includeAgents?: boolean;
};

/**
 * Build the complete form schema for the application configuration
 */
export function buildAppConfigSchema(
  options: BuildFormSchemaOptions = {},
): FormSchema {
  const sections: SectionSchema[] = [];

  // Always include defaults section
  sections.push(
    getDefaultsSectionSchema({
      providers: options.providers,
      agents: options.agents,
    }),
  );

  // Optionally include providers section
  if (options.includeProviders !== false) {
    sections.push(getProvidersSectionSchema());
  }

  // Optionally include agents section
  if (options.includeAgents !== false) {
    sections.push(getAgentsSectionSchema());
  }

  return { sections };
}
