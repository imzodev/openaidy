import type { WorkflowTemplate } from '@openaidy/shared-types';

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
 * Detects a cycle in the `from -> to` edges using a standard three-color
 * DFS (white/gray/black), where an edge back into a node still on the
 * current DFS stack (gray) means a cycle.
 */
function hasCycle(
  nodeKeys: string[],
  edges: Array<{ from: string; to: string }>,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const key of nodeKeys) adjacency.set(key, []);
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const state = new Map<string, 'visiting' | 'done'>();

  function visit(key: string): boolean {
    const current = state.get(key);
    if (current === 'visiting') return true;
    if (current === 'done') return false;

    state.set(key, 'visiting');
    for (const next of adjacency.get(key) ?? []) {
      if (visit(next)) return true;
    }
    state.set(key, 'done');
    return false;
  }

  return nodeKeys.some((key) => !state.has(key) && visit(key));
}

/**
 * Validates a workflow template's structural integrity — the invariants
 * that keep an authored template from silently producing a broken graph
 * when applied. Run over the whole registry in `validate.test.ts` so a
 * new template can't ship broken without a hand review catching it.
 */
export function validateWorkflowTemplate(template: WorkflowTemplate): string[] {
  const errors: string[] = [];
  const nodeKeys = template.nodes.map((n) => n.key);
  const nodeKeySet = new Set(nodeKeys);
  const inputKeySet = new Set(template.inputs.map((i) => i.key));

  if (nodeKeySet.size !== nodeKeys.length) {
    errors.push('duplicate node keys');
  }

  for (const node of template.nodes) {
    if (node.loop && node.kind !== 'agent') {
      errors.push(
        `node "${node.key}": loop config is only valid on agent nodes`,
      );
    }
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
    if (!nodeKeySet.has(edge.from)) {
      errors.push(`edge references unknown node "${edge.from}"`);
    }
    if (!nodeKeySet.has(edge.to)) {
      errors.push(`edge references unknown node "${edge.to}"`);
    }
    if (edge.from === edge.to) {
      errors.push(`edge "${edge.from}" -> "${edge.to}": self-edge`);
    }
    if (edge.edgeKind === 'conditional') {
      if (!edge.conditionOperator || !edge.conditionValue) {
        errors.push(
          `edge "${edge.from}" -> "${edge.to}": conditional edge missing operator/value`,
        );
      }
      for (const placeholder of extractPlaceholders(edge.conditionValue)) {
        if (!inputKeySet.has(placeholder)) {
          errors.push(
            `edge "${edge.from}" -> "${edge.to}": references undeclared input "{{${placeholder}}}"`,
          );
        }
      }
    }
  }

  if (hasCycle(nodeKeys, template.edges)) {
    errors.push('graph contains a cycle');
  }

  return errors;
}
