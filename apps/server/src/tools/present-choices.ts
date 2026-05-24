import type { BuiltinTool } from '@openaidy/runtime';
import type { PresentChoicesArgs } from '@openaidy/shared-types';
import { presentChoicesMeta } from './catalog.js';

/**
 * present_choices native tool
 *
 * Signals to the agentic loop that execution should pause and present
 * choice options to the user via an interactive UI card.
 *
 * The INTERRUPT_CHOICES sentinel is serialized as JSON and prefixed with
 * a marker. The agentic loop in SessionMessageService intercepts this
 * marker and emits a choices event instead of treating it as a normal
 * tool result.
 */
export const presentChoicesTool: BuiltinTool = {
  name: presentChoicesMeta.name,
  description: presentChoicesMeta.description,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Optional framing text shown above the choices.',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: 'Between 2 and 6 short option labels.',
      },
    },
    required: ['choices'],
  },

  async execute(args: Record<string, unknown>, _ctx: { agentId: string }) {
    const typedArgs = args as unknown as PresentChoicesArgs;
    // Serialize the interrupt sentinel so the agentic loop can detect and handle it.
    // The session service will parse this and emit a session.run.choices event.
    return {
      ok: true,
      content: JSON.stringify({
        _type: 'INTERRUPT_CHOICES',
        question: typedArgs.question ?? null,
        choices: typedArgs.choices,
      }),
    };
  },
};
