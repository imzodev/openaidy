import type {
  MessageMatchType,
  ResolvedTemplateTrigger,
  ScheduleInput,
} from '@openaidy/shared-types';
import { MESSAGE_MATCH_TYPE_VALUES } from '@openaidy/shared-types';
import type { WorkflowGraph } from '@openaidy/workflow-templates';
import type { AgentRegistry } from '../../agents';
import type { createLogger } from '../../lib/logger';
import { resolveDefaultModel } from '../../planning/service';
import type { ProviderServices } from '../../providers';
import { parseScheduleInput } from '../../pulses/utils';
import type { ServiceResult } from '../../types';
import { parseGraphSpec } from '../graph-spec';
import type { TaskService } from '../service';

/** A workflow drafted from a description, not saved anywhere yet. */
export type WorkflowDraft = {
  title: string;
  graph: WorkflowGraph;
  trigger: ResolvedTemplateTrigger | null;
  /** Things the user should look at (warnings, dropped trigger). */
  warnings: string[];
};

export type WorkflowDraftServiceDeps = {
  providers: ProviderServices;
  agents: AgentRegistry | undefined;
  getDefaultAgentId: () => string | undefined;
  listChannels: () => Array<{ id: string; type: string }>;
  taskService: Pick<TaskService, 'checkWorkflowGraph'>;
  logger: ReturnType<typeof createLogger>;
};

const MAX_DESCRIPTION_CHARS = 4000;

const SYSTEM_PROMPT = `You design workflows for OpenAidy, an AI agent platform used by small businesses.
A workflow is a graph of steps. Reply with ONLY a JSON object, no prose, in this shape:

{
  "title": "Short name, 2-6 words",
  "nodes": [
    {"key": "short_id", "title": "Short step title", "description": "Clear instructions for the agent doing this step", "kind": "agent", "agent": "agent id or null"},
    {"key": "review", "title": "Approve …", "kind": "approval_gate"}
  ],
  "edges": [
    {"from": "short_id", "to": "review"},
    {"from": "review", "to": "send", "condition": "approved"}
  ],
  "trigger": null
}

Rules:
- kind "agent": an AI agent does the work with its tools. kind "approval_gate": the workflow waits for a person to approve or reject. Put an approval_gate before anything that sends messages to customers, publishes, pays, deletes or spends money, unless the user clearly doesn't want one.
- An edge "from" → "to" means "to" waits for "from". Add "condition" to take an edge only for one outcome of "from": the step decides by ending its reply with "OUTCOME: <value>". Tell it the possible values in its description. An approval_gate's outcome is always "approved" or "rejected".
- Steps whose incoming edges were not taken are skipped; a step after two exclusive branches runs after whichever one ran.
- No cycles. To repeat a step until something is true, give it "loop": {"maxIterations": 3, "conditionOperator": "equals", "conditionValue": "PASS"} instead.
- Keep it small: 2-7 steps. Write descriptions so a capable assistant could do the step alone; mention which tools or integrations to use. If the user writes in Spanish, write titles and descriptions in Spanish.
- "agent": use an agent id from the list below when one clearly fits (e.g. it has the needed integration); otherwise null.
- To message someone (the owner, a customer) a step uses the channel_send tool with a channel id and a phone number.
- "trigger" — how the workflow starts, or null to start it by hand:
  - {"kind": "channel_message", "channelId": "<channel id>", "match": {"type": "starts_with" | "contains" | "equals" | "regex" | "any", "value": "word"}} when it should react to a WhatsApp/Discord message. The message is given to every step as the workflow input, and the last step's reply is sent back to the chat.
  - {"kind": "schedule", "schedule": {"daily": {"hour": 8, "minute": 0}}} or {"every": "1h"} (15m, 30m, 1h, 6h, 12h, 1d, 1w) or {"cron": "0 9 * * 1"} for recurring work.
  - {"kind": "webhook"} when another service (a form, a store) should start it; its request body is the input.`;

function contextPrompt(
  agents: Array<{
    id: string;
    name: string;
    description?: string | undefined;
    mcpServers?: Array<{ id: string }> | undefined;
  }>,
  channels: Array<{ id: string; type: string }>,
): string {
  const agentLines = agents.length
    ? agents
        .map(
          (a) =>
            `- ${a.id} (${a.name})${a.description ? `: ${a.description}` : ''}${a.mcpServers?.length ? ` — integrations: ${a.mcpServers.map((m) => m.id).join(', ')}` : ''}`,
        )
        .join('\n')
    : '(none)';
  const channelLines = channels.length
    ? channels.map((c) => `- ${c.id} (${c.type})`).join('\n')
    : '(none — a channel_message trigger is not possible)';
  return `Available agents:\n${agentLines}\n\nConnected channels:\n${channelLines}`;
}

/** The JSON object in a model reply (bare, or in a ``` block). */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Turns "when a customer sends 'cita' on WhatsApp, offer two slots and
 * ask me before confirming" into a workflow graph (with branches,
 * approvals, loops and a suggested trigger) the person reviews before it
 * is created. Uses the default agent's model in a single completion, then
 * the shared graph validator; one repair round fixes most mistakes.
 */
export class WorkflowDraftService {
  constructor(private readonly deps: WorkflowDraftServiceDeps) {}

  async draft(description: string): Promise<ServiceResult<WorkflowDraft>> {
    const request = description.trim().slice(0, MAX_DESCRIPTION_CHARS);
    if (!request) {
      return {
        ok: false,
        error: {
          code: 'draft.empty',
          message: 'Describe what the workflow should do.',
        },
      };
    }
    const model = resolveDefaultModel(
      this.deps.providers,
      this.deps.agents,
      this.deps.getDefaultAgentId,
    );
    if (!model) {
      return {
        ok: false,
        error: {
          code: 'draft.no_model',
          message:
            'No model is configured. Set a model on the default agent or a default provider.',
        },
      };
    }

    const agents = this.deps.agents?.listAgents() ?? [];
    const channels = this.deps.listChannels();
    const messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${contextPrompt(agents, channels)}\n\nThe workflow I want:\n${request}`,
      },
    ];

    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.deps.providers.invocation.invoke(
        { model: model.modelId, messages },
        { providerId: model.providerId },
      );
      if (!result.ok) {
        return {
          ok: false,
          error: { code: 'draft.model_error', message: result.error.message },
        };
      }
      const reply = result.value.content;
      const outcome = this.interpret(reply, channels);
      if (outcome.ok) return outcome;
      problems = outcome.problems;
      this.deps.logger.info('Workflow draft had problems', {
        attempt,
        problems,
      });
      messages.push(
        { role: 'assistant', content: reply },
        {
          role: 'user',
          content: `That workflow has problems:\n${problems.map((p) => `- ${p}`).join('\n')}\n\nReply with the corrected, complete JSON only.`,
        },
      );
    }
    return {
      ok: false,
      error: {
        code: 'draft.invalid',
        message: `Couldn't draft a valid workflow from that description. Try describing the steps more concretely.\n${problems.map((p) => `- ${p}`).join('\n')}`,
      },
    };
  }

  private interpret(
    reply: string,
    channels: Array<{ id: string; type: string }>,
  ):
    | (ServiceResult<WorkflowDraft> & { ok: true })
    | { ok: false; problems: string[] } {
    const json = extractJson(reply);
    if (!json)
      return { ok: false, problems: ['The reply was not a JSON object.'] };

    const spec = parseGraphSpec(json['nodes'], json['edges'] ?? []);
    if (!spec.ok) return { ok: false, problems: [spec.error] };
    const check = this.deps.taskService.checkWorkflowGraph(spec.graph);
    const errors = [...check.errors.map((e) => e.message)];
    if (spec.graph.nodes.length === 0)
      errors.push('The workflow has no steps.');
    if (errors.length) return { ok: false, problems: errors };

    const warnings = check.warnings.map((w) => w.message);
    const trigger = parseTrigger(json['trigger'], channels, warnings);
    const title =
      typeof json['title'] === 'string' && json['title'].trim()
        ? json['title'].trim().slice(0, 80)
        : 'New workflow';
    return {
      ok: true,
      data: { title, graph: spec.graph, trigger, warnings },
    };
  }
}

/**
 * The suggested trigger, if it's usable; otherwise null with a warning,
 * since a workflow without one can still be run by hand.
 */
function parseTrigger(
  raw: unknown,
  channels: Array<{ id: string; type: string }>,
  warnings: string[],
): ResolvedTemplateTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (t['kind'] === 'webhook') return { kind: 'webhook' };
  if (t['kind'] === 'schedule') {
    try {
      parseScheduleInput(t['schedule'] as ScheduleInput);
      return { kind: 'schedule', schedule: t['schedule'] as ScheduleInput };
    } catch {
      warnings.push(
        "The suggested schedule wasn't valid, so the workflow will start by hand; add a schedule after creating it.",
      );
      return null;
    }
  }
  if (t['kind'] === 'channel_message') {
    const channelId = t['channelId'];
    const match = (t['match'] ?? {}) as Record<string, unknown>;
    const type = match['type'] as MessageMatchType;
    const value = typeof match['value'] === 'string' ? match['value'] : '';
    if (
      typeof channelId !== 'string' ||
      !channels.some((c) => c.id === channelId)
    ) {
      warnings.push(
        "It should start from a chat message, but that channel isn't connected; add a message trigger after creating it.",
      );
      return null;
    }
    if (
      !MESSAGE_MATCH_TYPE_VALUES.includes(type) ||
      (type !== 'any' && !value.trim())
    ) {
      warnings.push(
        "The suggested message rule wasn't usable; add a message trigger after creating it.",
      );
      return null;
    }
    return {
      kind: 'channel_message',
      channelId,
      match: { type, ...(value.trim() ? { value: value.trim() } : {}) },
      replyWithResult: true,
    };
  }
  return null;
}
