/**
 * present_choices native tool
 *
 * Presents a set of choices to the user via WebSocket event and waits for
 * a reply before returning. The LLM blocks until the user picks one.
 *
 * Usage in agent prompt:
 *   Use the present_choices tool when you need the user to pick from options.
 *   Pass a question and between 2–6 choices.
 *   The user's selection is returned as the tool result content.
 *
 * Flow:
 *   1. LLM calls present_choices with { question, choices }
 *   2. Tool emits session.run.choices to all subscribed WS clients
 *   3. Tool suspends, waiting for a response from the client
 *   4. Client sends session.choices_response with the picked choice
 *   5. Tool resumes, returns the chosen option as content
 */

import type { FastifyBaseLogger } from 'fastify';
import type { BuiltinTool, BuiltinToolContext } from '@openaidy/runtime';
import type { ChoicesEvent } from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/** Arguments the LLM passes when calling present_choices */
export type PresentChoicesArguments = {
  /** Optional framing question shown above the choices */
  question?: string;
  /** Between 2 and 6 labelled options */
  choices: string[];
};

/** Result returned to the model once the user has chosen */
export type PresentChoicesResult = {
  /** The label of the chosen option */
  selected: string;
  /** 0-based index of the chosen option */
  index: number;
};

// ============================================================================
// Pending Choice — global pending queue (one at a time per server)
// ============================================================================

type PendingChoice = {
  resolve: (result: PresentChoicesResult) => void;
  reject: (reason: unknown) => void;
  event: ChoicesEvent;
  timeoutMs: number;
};

const pendingChoices = new Map<string, PendingChoice>();

/**
 * Resolve a pending choice by its session+run ID.
 * Called by the session handler when a session.choices_response message arrives.
 */
export function resolvePendingChoice(
  sessionId: string,
  runId: string,
  selected: string,
  index: number,
): boolean {
  const key = `${sessionId}:${runId}`;
  const pending = pendingChoices.get(key);
  if (!pending) return false;
  pending.resolve({ selected, index });
  pendingChoices.delete(key);
  return true;
}

/**
 * Reject a pending choice (e.g. on timeout or session end).
 */
export function rejectPendingChoice(
  sessionId: string,
  runId: string,
  reason: unknown,
): boolean {
  const key = `${sessionId}:${runId}`;
  const pending = pendingChoices.get(key);
  if (!pending) return false;
  pending.reject(reason);
  pendingChoices.delete(key);
  return true;
}

// ============================================================================
// Tool Definition
// ============================================================================

const TOOL_NAME = 'present_choices';

const TOOL_DESCRIPTION =
  'Present 2–6 labelled choices to the user and wait for their selection. ' +
  'Use this when you want the user to pick one option. ' +
  'Returns the label of the chosen option and its index. ' +
  'The question field is optional framing text shown above the choices.';

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'Optional framing question shown above the choices. ' +
        'E.g. "What would you like to do?"',
    },
    choices: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 6,
      description:
        'Array of 2 to 6 choice labels. Each should be a short ' +
        'human-readable label the user can pick from.',
    },
  },
  required: ['choices'],
  additionalProperties: false,
} as const;

// ============================================================================
// Tool Implementation
// ============================================================================

export function createPresentChoicesTool(
  emitEvent: (event: ChoicesEvent) => void,
  logger?: FastifyBaseLogger,
): BuiltinTool {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,

    async execute(
      args: Record<string, unknown>,
      ctx: BuiltinToolContext,
    ): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
      const { question, choices } = args as PresentChoicesArguments;

      // Validate
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > 6) {
        return {
          ok: false,
          error: `present_choices requires 2–6 choices, got ${choices?.length ?? 0}`,
        };
      }

      for (const c of choices) {
        if (typeof c !== 'string' || !c.trim()) {
          return { ok: false, error: 'All choices must be non-empty strings' };
        }
      }

      // We need sessionId and runId from the context — the BuiltinToolContext
      // only provides agentId. We embed them in the arguments by the caller,
      // or we require the session handler to have injected them.
      const sessionId = (args['sessionId'] as string | undefined) ?? 'unknown';
      const runId = (args['runId'] as string | undefined) ?? 'unknown';

      const event: ChoicesEvent = {
        runId,
        sessionId,
        agentId: ctx.agentId,
        ...(question !== undefined && { question }),
        choices: choices as string[],
      };

      logger?.info(
        { sessionId, runId, agentId: ctx.agentId, choices },
        '[present_choices] emitting choices event',
      );

      // Emit the choices event to WebSocket clients
      emitEvent(event);

      // Block and wait for the user's response via session.choices_response
      return new Promise<{ ok: true; content: string }>((resolve, reject) => {
        const key = `${sessionId}:${runId}`;
        const TIMEOUT_MS = 300_000; // 5 minute default

        const timeout = setTimeout(() => {
          pendingChoices.delete(key);
          logger?.warn(
            { sessionId, runId },
            '[present_choices] timed out waiting for choice',
          );
          reject(new Error('present_choices timed out after 5 minutes'));
        }, TIMEOUT_MS);

        pendingChoices.set(key, {
          resolve: (result) => {
            clearTimeout(timeout);
            const content = JSON.stringify(result);
            logger?.info(
              { sessionId, runId, result },
              '[present_choices] user selected, returning to model',
            );
            resolve({ ok: true, content });
          },
          reject: (reason) => {
            clearTimeout(timeout);
            pendingChoices.delete(key);
            reject(reason);
          },
          event,
          timeoutMs: TIMEOUT_MS,
        });
      });
    },
  };
}

// ============================================================================
// Export a pre-wired singleton instance
// The actual wiring (event → StreamManager → WS) is done in websocket/handlers.
// ============================================================================

// Lazy-initialized tool instance — eventEmitter injected by websocket setup
let _emitEvent: ((event: ChoicesEvent) => void) | null = null;
let _logger: FastifyBaseLogger | undefined;

/**
 * Inject the event emitter and logger from the websocket layer.
 * Must be called once before getPresentChoicesTool() is called.
 */
export function initPresentChoicesTool(
  emitEvent: (event: ChoicesEvent) => void,
  logger?: FastifyBaseLogger,
): void {
  _emitEvent = emitEvent;
  _logger = logger;
}

/** Returns a fresh tool instance each call (safe to register multiple times) */
export function getPresentChoicesTool(): BuiltinTool {
  if (!_emitEvent) {
    throw new Error(
      'present_choices tool not initialized — call initPresentChoicesTool() first',
    );
  }
  return createPresentChoicesTool(_emitEvent, _logger);
}

/** Type describing the ChoicesEvent emitter function */
export type ChoicesEventEmitter = (event: ChoicesEvent) => void;
