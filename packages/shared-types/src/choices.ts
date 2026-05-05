/**
 * Shared types for the present_choices native tool.
 * Used across server, SDK, and client packages.
 */

/**
 * Payload for the present_choices native tool call.
 * The argument object the LLM passes when it calls the tool.
 */
export type PresentChoicesArgs = {
  /** Optional framing question shown above the choices */
  question?: string;
  /** Between 2 and 6 labelled options */
  choices: string[];
};

/**
 * The structured event emitted by the server when an agent calls present_choices.
 * Sent over WebSocket as part of the run event stream.
 */
export type ChoicesEvent = {
  runId: string;
  sessionId: string;
  agentId: string;
  question: string;
  choices: string[];
};
