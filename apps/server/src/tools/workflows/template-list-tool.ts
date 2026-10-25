import type { BuiltinTool } from '@openaidy/runtime';
import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';
import { workflowTemplateListMeta } from '../catalog.js';

/**
 * workflow_template_list
 *
 * The built-in templates with what each needs (inputs, integrations) and
 * how it starts, so an agent can pick one and fill in templateInputs.
 */
export function createWorkflowTemplateListTool(): BuiltinTool {
  return {
    name: workflowTemplateListMeta.name,
    description: workflowTemplateListMeta.description,
    parameters: { type: 'object', properties: {} },

    async execute() {
      const lines = WORKFLOW_TEMPLATES.map((t) => {
        const inputs = t.inputs
          .map((i) => {
            const options = i.options?.length
              ? ` one of ${i.options.map((o) => o.value).join('/')}`
              : '';
            const extra = [
              i.required ? 'required' : null,
              i.default !== undefined ? `default "${i.default}"` : null,
            ]
              .filter(Boolean)
              .join(', ');
            return `    - ${i.key} (${i.type}${options}${extra ? `; ${extra}` : ''}): ${i.label}`;
          })
          .join('\n');
        const needs = t.requirements.map((r) => r.label).join('; ');
        const starts = t.trigger
          ? t.trigger.kind === 'schedule'
            ? `schedule ${JSON.stringify(t.trigger.schedule)}`
            : t.trigger.kind === 'webhook'
              ? 'webhook'
              : `message ${t.trigger.match.type.replace('_', ' ')} "${t.trigger.match.value ?? ''}"`
          : 'manually';
        return `- ${t.id}: ${t.name} — ${t.description}\n  Starts: ${starts}${needs ? `\n  Needs: ${needs}` : ''}\n  Inputs:\n${inputs}`;
      });
      return { ok: true, content: lines.join('\n\n') };
    },
  };
}
