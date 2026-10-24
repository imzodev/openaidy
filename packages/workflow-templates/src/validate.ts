import type { WorkflowTemplate } from '@openaidy/shared-types';
import { validateWorkflowGraph } from './graph.js';

/**
 * Matches a `{{inputKey}}` placeholder in template node/edge text. Shared
 * by structural validation (below) and template application
 * (`WorkflowTemplateOperations.applyTemplate`) so both agree on exactly
 * one placeholder syntax.
 */
export const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

export function extractPlaceholders(text: string | undefined): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(PLACEHOLDER_PATTERN), (m) => m[1]!);
}

/**
 * Replaces every `{{inputKey}}` placeholder in `text` with its resolved
 * value, leaving unresolved placeholders (no matching key in `values`)
 * untouched.
 */
export function substitutePlaceholders(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(
    PLACEHOLDER_PATTERN,
    (match, key) => values[key] ?? match,
  );
}

/**
 * Validates a workflow template's structural integrity — the invariants
 * that keep an authored template from silently producing a broken graph
 * when applied. The graph rules are the shared `validateWorkflowGraph`;
 * on top of them a template's `{{placeholders}}` must name declared
 * inputs. Run over the whole registry in `validate.test.ts` so a new
 * template can't ship broken without a hand review catching it.
 */
export function validateWorkflowTemplate(template: WorkflowTemplate): string[] {
  const errors = validateWorkflowGraph({
    nodes: template.nodes.map((node) => ({
      key: node.key,
      title: node.title ?? null,
      description: node.description,
      kind: node.kind,
      loop: node.loop ?? null,
    })),
    edges: template.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      edgeKind: edge.edgeKind,
      conditionOperator: edge.conditionOperator ?? null,
      conditionValue: edge.conditionValue ?? null,
    })),
  }).errors.map((issue) => issue.message);

  const inputKeySet = new Set(template.inputs.map((i) => i.key));
  for (const node of template.nodes) {
    for (const placeholder of [
      ...extractPlaceholders(node.title),
      ...extractPlaceholders(node.description),
    ]) {
      if (!inputKeySet.has(placeholder)) {
        errors.push(
          `node "${node.key}": references undeclared input "{{${placeholder}}}"`,
        );
      }
    }
  }
  for (const edge of template.edges) {
    for (const placeholder of extractPlaceholders(edge.conditionValue)) {
      if (!inputKeySet.has(placeholder)) {
        errors.push(
          `edge "${edge.from}" -> "${edge.to}": references undeclared input "{{${placeholder}}}"`,
        );
      }
    }
  }

  return errors;
}
