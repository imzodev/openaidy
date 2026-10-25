import type {
  ConditionOperator,
  LoopConfig,
  MessageMatchType,
  SubtaskKind,
} from './tasks.js';
import type { ScheduleInput } from './pulses.js';

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
  // An agent id, picked from the configured agents.
  'agent',
  // A channel id (WhatsApp, Discord…), picked from the configured channels.
  'channel',
  // Longer free text (e.g. business details, FAQ answers).
  'text',
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
  /** One line under the field explaining what to enter. */
  help?: string;
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
    /**
     * At least one agent must use one of these MCP servers (ids from the
     * integrations catalog, e.g. `google-calendar`, `stripe`).
     */
    mcpServerIds?: string[];
    /** At least one agent must have every one of these built-in tools. */
    tools?: string[];
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
  /**
   * Agent that runs the step: an agent id, or a `{{inputKey}}` placeholder
   * for an `agent` input. Unknown or empty → the default agent.
   */
  agent?: string;
};

/**
 * How a template's workflow is meant to start. Applying a template doesn't
 * create it by itself; the creator offers to set it up. String fields may
 * contain `{{inputKey}}` placeholders.
 */
export type TemplateTrigger =
  | {
      kind: 'channel_message';
      /** Placeholder for the `channel` input the trigger listens on. */
      channel: string;
      match: { type: MessageMatchType; value?: string };
      replyWithResult: boolean;
      ackText?: string;
    }
  | { kind: 'webhook' }
  | { kind: 'schedule'; schedule: ScheduleInput };

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

/** A template's suggested trigger with its placeholders filled in. */
export type ResolvedTemplateTrigger =
  | {
      kind: 'channel_message';
      channelId: string;
      match: { type: MessageMatchType; value?: string };
      replyWithResult: boolean;
      ackText?: string;
    }
  | { kind: 'webhook' }
  | { kind: 'schedule'; schedule: ScheduleInput };

/** What applying a template created, and how it suggests starting. */
export type ApplyTemplateResult = {
  nodeCount: number;
  edgeCount: number;
  trigger?: ResolvedTemplateTrigger;
};

export const TEMPLATE_CATEGORY_VALUES = [
  'sales',
  'support',
  'finance',
  'marketing',
  'ops',
  'content',
  'engineering',
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
  /** The suggested way the workflow starts (offered at creation). */
  trigger?: TemplateTrigger;
};

/**
 * Payload a workflow-creation form submits: the task to create, plus an
 * optional template to seed its subtask graph from. Generic over the
 * caller's own task-creation input shape so this package doesn't need a
 * dependency on any particular `CreateTaskInput`.
 */
export type CreateWorkflowSubmitInput<TCreateTaskInput = unknown> = {
  task: TCreateTaskInput;
  /** Seed the graph from a template; `setupTrigger` also sets up its
   * suggested trigger or schedule. */
  template?: {
    templateId: string;
    inputs: Record<string, string>;
    setupTrigger?: boolean;
  };
  /** A whole graph (e.g. a draft from a description), sent to
   * PUT /tasks/:id/graph. */
  graph?: { nodes: unknown[]; edges: unknown[] };
  /** A trigger or schedule to set up once the workflow exists. */
  trigger?: ResolvedTemplateTrigger;
};

/** A workflow drafted from a description (POST /workflows/draft). */
export type WorkflowDraftDto = {
  title: string;
  graph: {
    nodes: Array<{
      key: string;
      title?: string | null;
      description?: string | null;
      kind?: string | null;
      agentId?: string | null;
      loop?: {
        maxIterations: number;
        conditionOperator: string;
        conditionValue: string;
      } | null;
    }>;
    edges: Array<{
      from: string;
      to: string;
      edgeKind?: string | null;
      conditionOperator?: string | null;
      conditionValue?: string | null;
    }>;
  };
  trigger: ResolvedTemplateTrigger | null;
  warnings: string[];
};
