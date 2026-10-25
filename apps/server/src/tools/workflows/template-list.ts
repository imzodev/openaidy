import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';

/** `"id" (name)` for every built-in template, for tool descriptions. */
export const TEMPLATE_ID_LIST = WORKFLOW_TEMPLATES.map(
  (t) => `"${t.id}" (${t.name})`,
).join(', ');
