import type { ConditionOperator, LoopConfig, SubtaskKind } from './tasks.js';

// ========================================
// Workflow Template Types
// ========================================
//
// A workflow template is a reusable, pre-built subtask graph a user can
// apply to a freshly created task (a "workflow") instead of hand-authoring
// the graph or waiting on the AI planner. Templates are static, curated
// data — not a DB-backed entity — living in `@openaidy/workflow-templates`
// and typed here for both the server (apply-time) and web (gallery/preview)
// packages to share.

export const TEMPLATE_INPUT_TYPE_VALUES = [
  'string',
  'number',
  'boolean',
  'select',
] as const;

export type TemplateInputType = (typeof TEMPLATE_INPUT_TYPE_VALUES)[number];

/**
 * A per-run value a template needs from the user at apply time (e.g. a
 * repo name or target branch). Substituted into node/edge text via
 * `{{key}}` placeholders — see `TemplateNode`/`TemplateEdge`.
 */
export type TemplateInput = {
  key: string;
  label: string;
  type: TemplateInputType;
  required?: boolean;
  default?: string;
  /** Only meaningful when `type: 'select'`. */
  options?: Array<{ value: string; label: string }>;
};

/**
 * A capability the template expects at least one agent to have
 * configured (e.g. GitHub MCP access) so a node can act on the outside
 * world. Checked advisorily against the user's configured agents at
 * apply time — not a hard gate, since there's no per-tool introspection
 * of an agent's MCP servers yet.
 */
export type TemplateRequirement = {
  key: string;
  label: string;
  check: {
    /** At least one agent must have a non-empty `mcpServers` list. */
    mcpServerConfigured?: boolean;
  };
};

/**
 * One node in a template's subtask graph. `key` is a template-local
 * identifier (not a real subtask id) used to wire up `TemplateEdge`s;
 * it's resolved to a real subtask id when the template is applied.
 * `title`/`description` may contain `{{inputKey}}` placeholders.
 */
export type TemplateNode = {
  key: string;
  title?: string;
  description: string;
  kind: SubtaskKind;
  /** Only meaningful when `kind: 'agent'`. */
  loop?: LoopConfig | null;
};

/**
 * One dependency edge in a template's subtask graph. The arrow points
 * from `from` (the upstream/depended-on node) to `to` (the downstream
 * node that won't start until `from` completes) — matching how the
 * graph reads visually. `conditionValue` may contain a `{{inputKey}}`
 * placeholder.
 */
export type TemplateEdge = {
  from: string;
  to: string;
  edgeKind: 'dependency' | 'conditional';
  conditionOperator?: ConditionOperator;
  conditionValue?: string;
};

export const TEMPLATE_CATEGORY_VALUES = [
  'engineering',
  'content',
  'ops',
  'support',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORY_VALUES)[number];

/**
 * A full workflow template: metadata for the gallery, the graph to seed,
 * the per-run inputs it needs, and the capabilities it expects an agent
 * to have.
 */
export type WorkflowTemplate = {
  id: string;
  version: number;
  name: string;
  description: string;
  category: TemplateCategory;
  inputs: TemplateInput[];
  requirements: TemplateRequirement[];
  nodes: TemplateNode[];
  edges: TemplateEdge[];
};
