import type { WorkflowTemplate } from '@openaidy/shared-types';
import { softwareDevelopmentWorkflowTemplate } from './software-development.js';

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  softwareDevelopmentWorkflowTemplate,
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
